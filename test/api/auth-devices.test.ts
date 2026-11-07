import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { POST as login } from '../../app/api/v1/auth/login/route.ts';
import { GET as sessionProfile } from '../../app/api/v1/auth/session/route.ts';
import { GET as listDevices } from '../../app/api/v1/auth/devices/route.ts';
import { DELETE as revokeDevice } from '../../app/api/v1/auth/devices/[sessionId]/route.ts';
import { PATCH as setOperator } from '../../app/api/v1/auth/operator/route.ts';

/**
 * Perangkat & operator pada satu akun bersama (Fase 0).
 *
 * Satu akun dipakai bergiliran di beberapa perangkat. Test ini menjaga:
 * - tiap login punya identitas perangkat sendiri (cookie HttpOnly + label UA);
 * - operator yang sedang memegang perangkat tercatat di sesi;
 * - sesi perangkat lain bisa dicabut tanpa mengeluarkan semua orang;
 * - jumlah sesi aktif tidak tumbuh tanpa batas.
 */

const tag = `dev-${Date.now()}`;

function loginRequest(deviceCookie: string | null, userAgent: string, operator?: string): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
    Host: 'localhost:3000',
    'User-Agent': userAgent,
  });
  if (deviceCookie) headers.set('Cookie', deviceCookie);
  if (operator) headers.set('X-Operator', operator);
  return new Request('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
}

let EMAIL = '';
const PASSWORD = 'PasswordSecret123!';
let adminId = '';

/** Ambil pasangan cookie dari respons login: sesi + perangkat. */
function cookiesOf(res: Response): { session: string; device: string; deviceId: string } {
  const all = res.headers.getSetCookie();
  const sessionCookie = all.find((c) => c.startsWith('esniffer_session='));
  const deviceCookie = all.find((c) => c.startsWith('esniffer_device='));
  assert.ok(sessionCookie, 'cookie sesi harus diterbitkan');
  assert.ok(deviceCookie, 'cookie perangkat harus diterbitkan');
  assert.match(deviceCookie, /HttpOnly/, 'cookie perangkat harus HttpOnly');
  assert.match(deviceCookie, /Max-Age=34560000/, 'cookie perangkat berumur panjang');
  return {
    session: sessionCookie.split(';')[0],
    device: deviceCookie.split(';')[0],
    deviceId: deviceCookie.split(';')[0].split('=')[1],
  };
}

function api(url: string, cookie: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  headers.set('Origin', 'http://localhost:3000');
  headers.set('Host', 'localhost:3000');
  return new Request(url, { ...init, headers });
}

describe('Sesi per perangkat & operator pada akun bersama', () => {
  before(async () => {
    EMAIL = `${tag}-admin@esniffer.local`;
    const passwordHash = await hashPassword(PASSWORD);
    const admin = await prisma.user.create({
      data: { email: EMAIL, passwordHash, role: 'ADMIN', isActive: true },
    });
    adminId = admin.id;
  });

  after(async () => {
    await prisma.authSession.deleteMany({ where: { userId: adminId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await closeDb();
  });

  it('1. login menerbitkan cookie perangkat dan mencatat labelnya di sesi', async () => {
    const androidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
    const res = await login(loginRequest(null, androidUa, 'Budi'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.device.id, 'respons memuat id perangkat');
    assert.strictEqual(body.data.device.label, 'Chrome · Android');
    assert.strictEqual(body.data.operator, 'Budi');

    const cookies = cookiesOf(res);
    const row = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOf(cookies.session) } });
    assert.strictEqual(row.deviceId, cookies.deviceId);
    assert.strictEqual(row.deviceLabel, 'Chrome · Android');
    assert.strictEqual(row.operatorName, 'Budi');
  });

  it('2. dua perangkat = dua sesi aktif, dan daftar perangkat menandai yang sedang dipakai', async () => {
    const laptopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    const res = await login(loginRequest(null, laptopUa, 'Sari'));
    assert.strictEqual(res.status, 200);
    const laptop = cookiesOf(res);

    const list = await listDevices(api('http://localhost:3000/api/v1/auth/devices', laptop.session));
    assert.strictEqual(list.status, 200);
    const rows = (await list.json()).data as Array<{
      deviceLabel: string;
      operatorName: string | null;
      current: boolean;
      id: string;
    }>;
    const active = rows;
    assert.ok(active.some((row) => row.deviceLabel === 'Chrome · Android' && row.operatorName === 'Budi'));
    assert.ok(active.some((row) => row.deviceLabel === 'Chrome · Windows' && row.operatorName === 'Sari'));
    assert.strictEqual(active.filter((row) => row.current).length, 1, 'tepat satu sesi ditandai sebagai perangkat ini');
  });

  it('3. header X-Operator memperbarui operator yang tercatat pada sesi itu', async () => {
    const res = await login(
      loginRequest(null, 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile', 'Budi')
    );
    const cookies = cookiesOf(res);

    // Operator berganti shift di perangkat yang sama.
    const profile = await sessionProfile(
      api('http://localhost:3000/api/v1/auth/session', cookies.session, {
        headers: { 'X-Operator': 'Sari' },
      })
    );
    assert.strictEqual(profile.status, 200);
    const row = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOf(cookies.session) } });
    assert.strictEqual(row.operatorName, 'Sari');
  });

  it('3b. PATCH /auth/operator mengganti operator perangkat ini dan menormalkan nama', async () => {
    const cookies = cookiesOf(await login(loginRequest(null, 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile', 'Budi')));

    const res = await setOperator(
      api('http://localhost:3000/api/v1/auth/operator', cookies.session, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: '  Budi   Santoso  ' }),
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data.operator, 'Budi Santoso', 'spasi berlebih dirapikan');

    const row = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOf(cookies.session) } });
    assert.strictEqual(row.operatorName, 'Budi Santoso', 'tersimpan di sesi, bukan hanya di browser');

    // Nama kosong = "belum diisi", bukan error; server memakai nilai bawaan.
    const cleared = await setOperator(
      api('http://localhost:3000/api/v1/auth/operator', cookies.session, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: '   ' }),
      })
    );
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual((await cleared.json()).data.operator, '');

    const bad = await setOperator(
      api('http://localhost:3000/api/v1/auth/operator', cookies.session, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator: 42 }),
      })
    );
    assert.strictEqual(bad.status, 422);
  });

  it('4. perangkat lain bisa dicabut tanpa mengeluarkan perangkat ini', async () => {
    const current = cookiesOf(await login(loginRequest(null, 'Mozilla/5.0 (iPad; CPU OS 17) Safari/604.1', 'Budi')));
    const other = cookiesOf(await login(loginRequest(null, 'Mozilla/5.0 (Linux; Android 12) Chrome/119 Mobile', 'Sari')));

    const list = await listDevices(api('http://localhost:3000/api/v1/auth/devices', current.session));
    const rows = (await list.json()).data as Array<{ id: string; current: boolean }>;
    const target = rows.find((row) => !row.current);
    assert.ok(target, 'harus ada perangkat lain untuk dicabut');

    const res = await revokeDevice(
      api(`http://localhost:3000/api/v1/auth/devices/${target.id}`, current.session, { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: target.id }) }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).data.self, false);

    // Cookie perangkat yang dicabut tidak bisa dipakai lagi.
    const after = await sessionProfile(api('http://localhost:3000/api/v1/auth/session', other.session));
    assert.strictEqual(after.status, 401, 'cookie perangkat yang dicabut harus ditolak');
    const revokedRow = await prisma.authSession.findUniqueOrThrow({ where: { id: target.id } });
    assert.ok(revokedRow.revokedAt, 'sesi perangkat itu harus tercatat dicabut');

    // Perangkat ini tetap hidup.
    const mine = await sessionProfile(api('http://localhost:3000/api/v1/auth/session', current.session));
    assert.strictEqual(mine.status, 200);
  });

  it('5. sesi pengguna lain tidak bisa dicabut lewat endpoint ini (404, tanpa bocor)', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: `${tag}-other@esniffer.local`,
        passwordHash: await hashPassword(PASSWORD),
        role: 'ADMIN',
        isActive: true,
      },
    });
    try {
      const otherSession = await prisma.authSession.create({
        data: {
          userId: otherUser.id,
          tokenHash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const mine = cookiesOf(await login(loginRequest(null, 'Mozilla/5.0 (Windows NT 10.0) Chrome/121', 'Budi')));
      const res = await revokeDevice(
        api(`http://localhost:3000/api/v1/auth/devices/${otherSession.id}`, mine.session, { method: 'DELETE' }),
        { params: Promise.resolve({ sessionId: otherSession.id }) }
      );
      assert.strictEqual(res.status, 404);
      const row = await prisma.authSession.findUniqueOrThrow({ where: { id: otherSession.id } });
      assert.strictEqual(row.revokedAt, null, 'sesi pengguna lain tidak boleh tersentuh');
    } finally {
      await prisma.authSession.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  it('6. login ulang di perangkat yang sama tidak menumpuk sesi', async () => {
    const device = cookiesOf(await login(loginRequest(null, 'Mozilla/5.0 (Linux; Android 14) Chrome/122 Mobile', 'Budi')));
    const before = await prisma.authSession.count({
      where: { userId: adminId, deviceId: device.deviceId, revokedAt: null },
    });
    assert.strictEqual(before, 1);

    const relogin = await login(loginRequest(device.device, 'Mozilla/5.0 (Linux; Android 14) Chrome/122 Mobile', 'Sari'));
    const again = cookiesOf(relogin);
    assert.strictEqual(again.deviceId, device.deviceId, 'perangkat yang sama dikenali dari cookie');
    const active = await prisma.authSession.count({
      where: { userId: adminId, deviceId: device.deviceId, revokedAt: null },
    });
    assert.strictEqual(active, 1, 'sesi lama perangkat itu dicabut, bukan dibiarkan menumpuk');

    const old = await sessionProfile(api('http://localhost:3000/api/v1/auth/session', device.session));
    assert.strictEqual(old.status, 401, 'cookie sesi lama tidak berlaku lagi');
  });

  it('7. jumlah sesi aktif dibatasi (MAX_SESSIONS_PER_USER)', async () => {
    const original = process.env.MAX_SESSIONS_PER_USER;
    process.env.MAX_SESSIONS_PER_USER = '2';
    try {
      const sessions: string[] = [];
      for (const ua of [
        'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605',
        'Mozilla/5.0 (X11; Linux x86_64) Firefox/121',
      ]) {
        const res = await login(loginRequest(null, ua, 'Budi'));
        assert.strictEqual(res.status, 200);
        sessions.push(cookiesOf(res).session);
      }
      const active = await prisma.authSession.count({
        where: { userId: adminId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      assert.strictEqual(active, 2, 'sesi tertua dicabut saat melewati batas');
    } finally {
      if (original === undefined) delete process.env.MAX_SESSIONS_PER_USER;
      else process.env.MAX_SESSIONS_PER_USER = original;
    }
  });
});

/** token hash yang sama dengan yang disimpan session.ts (SHA-256 hex). */
function hashOf(sessionCookie: string): string {
  const raw = sessionCookie.split('=').slice(1).join('=');
  return createHash('sha256').update(raw).digest('hex');
}
