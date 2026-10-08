import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { hashPassword } from '../../lib/auth/password.ts';

describe('Real Next.js HTTP Server Smoke Test', () => {
  const PORT = 3098;
  const BASE_URL = `http://127.0.0.1:${PORT}`;
  const testEmail = `smoke-${Date.now()}@esniffer.local`;
  const testPassword = 'SmokePassword123!';

  let serverProcess: ChildProcess;
  let userId: string;

  before(async () => {
    // 1. Buat user tes di database
    const passwordHash = await hashPassword(testPassword);
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    userId = user.id;

    // 2. Jalankan server Next.js asli pada port 3098 dengan konfigurasi produksi yang valid
    serverProcess = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        APP_BASE_URL: BASE_URL,
        AUTH_SECRET: 'smoke-test-auth-secret-key-for-e2e-testing',
        CURSOR_SIGNING_SECRET: 'smoke-test-cursor-signing-secret-key-testing',
      },
      stdio: 'ignore',
    });

    // 3. Tunggu hingga server siap melayani permintaan HTTP
    const maxRetries = 40;
    let ready = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`${BASE_URL}/api/v1/auth/session`);
        // Server aktif jika mengembalikan status HTTP (misal 401 unauthenticated)
        if (res.status === 401) {
          ready = true;
          break;
        }
      } catch {
        // Server belum mulai listen
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!ready) {
      serverProcess.kill('SIGTERM');
      throw new Error(`Next.js server failed to become ready on port ${PORT}`);
    }
  });

  after(async () => {
    // Matikan seluruh grup proses server Next.js secara tuntas
    if (serverProcess && serverProcess.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-serverProcess.pid, 'SIGKILL');
        } else {
          serverProcess.kill('SIGKILL');
        }
      } catch {
        try {
          serverProcess.kill('SIGKILL');
        } catch {
          // Abaikan jika proses sudah mati
        }
      }
    }

    // Bersihkan sesi dan user
    try {
      await prisma.authSession.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await closeDb();
    } catch {
      // Abaikan jika db sudah tertutup
    }
  });

  it('Siklus Lengkap HTTP: Login -> Cookie -> Protected Endpoint -> Logout -> 401', async () => {
    // 1. Login
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL,
      },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });

    assert.strictEqual(loginRes.status, 200, 'Login harus mengembalikan 200 OK');
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Set-Cookie harus ada pada respons login');
    assert.ok(setCookie.includes('esniffer_session='), 'Cookie esniffer_session harus terpasang');
    assert.ok(setCookie.includes('HttpOnly'), 'Cookie harus HttpOnly');
    assert.ok(setCookie.includes('Secure'), 'Cookie production harus Secure');
    assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie harus SameSite=Lax');
    assert.match(loginRes.headers.get('cache-control') || '', /no-store/);
    assert.strictEqual(loginRes.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(loginRes.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(loginRes.headers.get('x-powered-by'), null);

    const sessionCookie = setCookie.split(';')[0];
    const loginBody = await loginRes.json();
    assert.strictEqual(loginBody.data.user.email, testEmail);
    const csrfToken = loginBody.data.csrfToken;
    assert.ok(csrfToken, 'Login body harus menyertakan csrfToken');

    // 2. Akses endpoint terproteksi: GET /api/v1/auth/session
    const sessionRes = await fetch(`${BASE_URL}/api/v1/auth/session`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
      },
    });

    assert.strictEqual(sessionRes.status, 200, 'GET /session harus 200 OK');
    const sessionBody = await sessionRes.json();
    assert.strictEqual(sessionBody.data.user.email, testEmail);
    assert.strictEqual(sessionBody.data.user.role, 'ADMIN');

    // 3. Akses endpoint data terproteksi: GET /api/v1/chambers
    const chambersRes = await fetch(`${BASE_URL}/api/v1/chambers`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
      },
    });

    assert.strictEqual(chambersRes.status, 200, 'GET /chambers harus 200 OK');
    const chambersBody = await chambersRes.json();
    assert.ok(Array.isArray(chambersBody.data), 'Data chambers harus berupa array');

    // 4. Logout dengan Origin valid dan CSRF token
    const logoutRes = await fetch(`${BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        Origin: BASE_URL,
        'X-CSRF-Token': csrfToken,
      },
    });

    assert.strictEqual(logoutRes.status, 200, 'Logout harus 200 OK');
    const clearCookie = logoutRes.headers.get('set-cookie');
    assert.ok(clearCookie, 'Set-Cookie pembersih harus ada');
    assert.ok(clearCookie.includes('Max-Age=0'), 'Cookie harus di-expire dengan Max-Age=0');

    // 5. Akses ulang endpoint terproteksi dengan cookie lama -> Ditolak 401
    const postLogoutRes = await fetch(`${BASE_URL}/api/v1/auth/session`, {
      method: 'GET',
      headers: {
        Cookie: sessionCookie,
      },
    });

    assert.strictEqual(postLogoutRes.status, 401, 'Akses setelah logout harus 401 UNAUTHENTICATED');
    const postLogoutBody = await postLogoutRes.json();
    assert.strictEqual(postLogoutBody.error.code, 'UNAUTHENTICATED');
  });
});
