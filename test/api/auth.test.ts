import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { POST as loginHandler } from '../../app/api/v1/auth/login/route.ts';
import { POST as logoutHandler } from '../../app/api/v1/auth/logout/route.ts';
import { GET as sessionHandler } from '../../app/api/v1/auth/session/route.ts';
import { POST as createChamberHandler } from '../../app/api/v1/chambers/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';

describe('HTTP API v1: Authentication & Authorization Tests', () => {
  const adminEmail = `test-admin-${Date.now()}@esniffer.local`;
  const viewerEmail = `test-viewer-${Date.now()}@esniffer.local`;
  const inactiveEmail = `test-inactive-${Date.now()}@esniffer.local`;
  const testPassword = 'PasswordSecret123!';

  let adminCookie = '';
  let viewerCookie = '';
  // Chamber yang dibuat test ini — wajib dibersihkan di after() agar tidak
  // mengotori nav dashboard (best practice: test membersihkan buatannya sendiri).
  const createdChamberIds: string[] = [];

  before(async () => {
    // Buat password hash scrypt
    const passwordHash = await hashPassword(testPassword);

    // 1. Buat user ADMIN aktif
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    // 2. Buat user VIEWER aktif
    await prisma.user.create({
      data: {
        email: viewerEmail,
        passwordHash,
        role: 'VIEWER',
        isActive: true,
      },
    });

    // 3. Buat user non-aktif
    await prisma.user.create({
      data: {
        email: inactiveEmail,
        passwordHash,
        role: 'VIEWER',
        isActive: false,
      },
    });
  });

  after(async () => {
    // Bersihkan sesi dan user pengujian
    await prisma.authSession.deleteMany({
      where: {
        user: {
          email: { in: [adminEmail, viewerEmail, inactiveEmail] },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [adminEmail, viewerEmail, inactiveEmail] },
      },
    });
    // Bersihkan chamber buatan test ini (berdasarkan ID + pola nama khas file ini
    // sebagai jaring pengaman bila run sebelumnya terinterupsi).
    const residue = await prisma.chamber.findMany({
      where: {
        OR: [
          { id: { in: createdChamberIds } },
          {
            name: { in: ['Valid Admin Chamber', 'Valid CSRF Chamber'] },
            code: { notIn: ['CH-01', 'CH-02'] },
          },
        ],
      },
      select: { id: true },
    });
    const residueIds = residue.map((c) => c.id);
    if (residueIds.length > 0) {
      await prisma.deviceAssignment.deleteMany({ where: { chamberId: { in: residueIds } } });
      await prisma.sensorReading.deleteMany({ where: { chamberId: { in: residueIds } } });
      await prisma.chamber.deleteMany({ where: { id: { in: residueIds } } });
    }
    await closeDb();
  });

  it('1. Login berhasil dengan kredensial benar menghasilkan cookie HttpOnly dan profil user', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: testPassword }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 200);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Header Set-Cookie harus ada');
    assert.ok(setCookie.includes('esniffer_session='), 'Cookie esniffer_session harus ada');
    assert.ok(setCookie.includes('HttpOnly'), 'Cookie harus HttpOnly');
    assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie harus SameSite=Lax');

    adminCookie = setCookie.split(';')[0]; // Ambil "esniffer_session=..."

    const body = await res.json();
    assert.ok(body.data);
    assert.strictEqual(body.data.user.email, adminEmail);
    assert.strictEqual(body.data.user.role, 'ADMIN');
    assert.strictEqual(body.data.user.passwordHash, undefined, 'passwordHash tidak boleh dibocorkan');
  });

  it('2. Login gagal dengan password salah mengembalikan 401 generic', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'WrongPassword999' }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 401);

    const body = await res.json();
    assert.strictEqual(body.error.code, 'UNAUTHENTICATED');
    assert.strictEqual(body.error.message, 'Invalid email or password');
    assert.ok(body.error.requestId, 'requestId harus ada dalam error envelope');
  });

  it('3. User non-aktif ditolak saat login (401)', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inactiveEmail, password: testPassword }),
    });

    const res = await loginHandler(req);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'UNAUTHENTICATED');
  });

  it('4. GET /api/v1/auth/session membaca data sesi aktif', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/session', {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });

    const res = await sessionHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.data.user.email, adminEmail);
    assert.strictEqual(body.data.user.role, 'ADMIN');
    assert.ok(body.data.expiresAt);
  });

  it('5. Akses /api/v1/auth/session tanpa cookie ditolak 401', async () => {
    const req = new Request('http://localhost:3000/api/v1/auth/session', {
      method: 'GET',
    });

    const res = await sessionHandler(req);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'UNAUTHENTICATED');
  });

  it('6. Mutasi tanpa Origin atau CSRF header ditolak 403', async () => {
    const req = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'CH-X1', name: 'Test Chamber' }),
    });

    const res = await createChamberHandler(req);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('Origin or CSRF'));
  });

  it('7. Mutasi dengan Origin valid dari localhost atau X-CSRF-Token diizinkan', async () => {
    const req = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ code: `CH-${Date.now().toString().slice(-4)}`, name: 'Valid Admin Chamber' }),
    });

    const res = await createChamberHandler(req);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.data.id);
    createdChamberIds.push(body.data.id);
  });

  it('8. Role VIEWER ditolak saat mencoba mutasi admin (403)', async () => {
    // Login sebagai VIEWER
    const loginReq = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: testPassword }),
    });
    const loginRes = await loginHandler(loginReq);
    assert.strictEqual(loginRes.status, 200);
    viewerCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Coba buat chamber menggunakan viewerCookie
    const mutateReq = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: viewerCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ code: 'CH-FORBIDDEN', name: 'Forbidden Chamber' }),
    });

    const mutateRes = await createChamberHandler(mutateReq);
    assert.strictEqual(mutateRes.status, 403);
    const body = await mutateRes.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('VIEWER is not permitted'));
  });

  it('9. Foreign origin ditolak 403 meskipun menyertakan custom header', async () => {
    const req = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'https://attacker-website.com',
        Host: 'localhost:3000',
        'X-CSRF-Token': 'some-arbitrary-token',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ code: 'CH-ATTACK', name: 'Attack Chamber' }),
    });

    const res = await createChamberHandler(req);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('Cross-origin request rejected'));
  });

  it('10. Localhost loopback ditolak pada mode produksi bila tidak tercantum di allowlist', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalBase = process.env.APP_BASE_URL;
    const originalAllowlist = process.env.APP_ORIGIN_ALLOWLIST;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.APP_BASE_URL = 'https://esniffer.production.com';
      delete process.env.APP_ORIGIN_ALLOWLIST;

      const req = new Request('https://esniffer.production.com/api/v1/chambers', {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Host: 'esniffer.production.com',
        },
        body: JSON.stringify({ code: 'CH-PROD-LOCAL', name: 'Prod Local Chamber' }),
      });

      const res = await createChamberHandler(req);
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error.code, 'FORBIDDEN');
      assert.ok(body.error.message.includes('Cross-origin request rejected'));
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      process.env.APP_BASE_URL = originalBase;
      if (originalAllowlist) {
        process.env.APP_ORIGIN_ALLOWLIST = originalAllowlist;
      } else {
        delete process.env.APP_ORIGIN_ALLOWLIST;
      }
    }
  });

  it('11. Header CSRF token yang tidak valid atau dimanipulasi ditolak 403', async () => {
    const invalidCsrfReq = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'X-CSRF-Token': 'tampered-invalid-csrf-token-12345',
      },
      body: JSON.stringify({ code: 'CH-CSRF-BAD', name: 'Tampered CSRF Chamber' }),
    });

    const invalidCsrfRes = await createChamberHandler(invalidCsrfReq);
    assert.strictEqual(invalidCsrfRes.status, 403);
    const body = await invalidCsrfRes.json();
    assert.strictEqual(body.error.code, 'FORBIDDEN');
    assert.ok(body.error.message.includes('Invalid CSRF token'));
  });

  it('12. Mutasi dengan CSRF token valid diterima dan memuat header no-store', async () => {
    // Login fresh untuk mendapatkan session dan csrfToken
    const loginReq = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ email: adminEmail, password: testPassword }),
    });
    const loginRes = await loginHandler(loginReq);
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    const freshCookie = loginRes.headers.get('set-cookie')!.split(';')[0];
    const validCsrf = loginData.data.csrfToken;
    assert.ok(validCsrf, 'Login harus mengembalikan csrfToken valid');

    const validCsrfReq = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: freshCookie,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
        'X-CSRF-Token': validCsrf,
      },
      body: JSON.stringify({ code: `CH-CSRF-${Date.now().toString().slice(-4)}`, name: 'Valid CSRF Chamber' }),
    });

    const validCsrfRes = await createChamberHandler(validCsrfReq);
    assert.strictEqual(validCsrfRes.status, 201);
    createdChamberIds.push(((await validCsrfRes.json()) as { data: { id: string } }).data.id);
    const cacheHeader = validCsrfRes.headers.get('cache-control');
    assert.ok(cacheHeader?.includes('no-store'), 'Respons mutasi harus no-store');
    assert.ok(cacheHeader?.includes('private'), 'Respons mutasi harus private');
  });

  it('13. Logout mencabut sesi di database dan menghapus cookie', async () => {
    const logoutReq = new Request('http://localhost:3000/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
    });

    const logoutRes = await logoutHandler(logoutReq);
    assert.strictEqual(logoutRes.status, 200);

    const clearCookie = logoutRes.headers.get('set-cookie');
    assert.ok(clearCookie, 'Set-Cookie clear header harus ada');
    assert.ok(clearCookie.includes('Max-Age=0'));

    // Verifikasi bahwa cookie lama sekarang ditolak di session endpoint
    const sessionReq = new Request('http://localhost:3000/api/v1/auth/session', {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const sessionRes = await sessionHandler(sessionReq);
    assert.strictEqual(sessionRes.status, 401, 'Sesi yang telah dicabut harus mengembalikan 401');
  });

  it('14. CSRF token sesi A ditolak 403 ketika dipakai bersama cookie sesi B', async () => {
    // Login sebagai admin untuk mendapatkan sesi dan CSRF token segar
    const loginReqA = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ email: adminEmail, password: testPassword }),
    });
    const loginResA = await loginHandler(loginReqA);
    assert.strictEqual(loginResA.status, 200);
    const csrfA = (await loginResA.json()).data.csrfToken as string;

    // Login sebagai viewer untuk mendapatkan sesi berbeda
    const loginReqB = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ email: viewerEmail, password: testPassword }),
    });
    const loginResB = await loginHandler(loginReqB);
    assert.strictEqual(loginResB.status, 200);
    const cookieB = loginResB.headers.get('set-cookie')!.split(';')[0];

    // Kirim mutasi dengan cookie sesi B tetapi CSRF token dari sesi A
    const crossSessionReq = new Request('http://localhost:3000/api/v1/chambers', {
      method: 'POST',
      headers: {
        Cookie: cookieB,               // Sesi B
        'X-CSRF-Token': csrfA,         // CSRF milik sesi A — harus ditolak
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ code: `CH-CROSS-${Date.now().toString().slice(-4)}`, name: 'Cross-Session Test' }),
    });

    const crossSessionRes = await createChamberHandler(crossSessionReq);
    assert.strictEqual(crossSessionRes.status, 403, 'CSRF token dari sesi A harus ditolak 403 pada sesi B');
    const body = await crossSessionRes.json();
    assert.ok(body.error.message.includes('CSRF'), `Pesan error harus menyebutkan CSRF, dapat: ${body.error.message}`);

    // Cleanup
    await prisma.authSession.deleteMany({
      where: { user: { email: { in: [adminEmail, viewerEmail] } } },
    });
  });

  it('15. Refresh sesi → logout dengan CSRF yang dipulihkan → cookie lama menghasilkan 401', async () => {
    // Login segar untuk mendapatkan sesi
    const loginReq = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      body: JSON.stringify({ email: adminEmail, password: testPassword }),
    });
    const loginRes = await loginHandler(loginReq);
    assert.strictEqual(loginRes.status, 200);
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Simulasi "refresh halaman": panggil session endpoint untuk memulihkan CSRF token
    const sessionReq = new Request('http://localhost:3000/api/v1/auth/session', {
      method: 'GET',
      headers: { Cookie: sessionCookie, Host: 'localhost:3000' },
    });
    const sessionRes = await sessionHandler(sessionReq);
    assert.strictEqual(sessionRes.status, 200, 'Session endpoint harus mengembalikan 200 saat sesi valid');
    const recoveredCsrf = (await sessionRes.json()).data.csrfToken as string;
    assert.ok(recoveredCsrf, 'Session endpoint harus mengembalikan csrfToken yang dapat dipulihkan');

    // Logout menggunakan CSRF yang dipulihkan (bukan dari login)
    const logoutReq = new Request('http://localhost:3000/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'X-CSRF-Token': recoveredCsrf,
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
    });
    const logoutRes = await logoutHandler(logoutReq);
    assert.strictEqual(logoutRes.status, 200, 'Logout dengan CSRF yang dipulihkan harus berhasil (200)');

    // Verifikasi cookie lama menghasilkan 401
    const staleSessionReq = new Request('http://localhost:3000/api/v1/auth/session', {
      method: 'GET',
      headers: { Cookie: sessionCookie, Host: 'localhost:3000' },
    });
    const staleSessionRes = await sessionHandler(staleSessionReq);
    assert.strictEqual(staleSessionRes.status, 401, 'Cookie lama setelah logout harus menghasilkan 401');
  });
});
