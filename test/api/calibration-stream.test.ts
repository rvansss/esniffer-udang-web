import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { setClockForTests } from '../../lib/runtime/clock.ts';
import { GET as getStream } from '../../app/api/v1/batches/[batchId]/calibration/stream/route.ts';
import {
  DELETE as deleteCalibration,
  PUT as putCalibration,
} from '../../app/api/v1/groups/[groupId]/calibration/route.ts';

/**
 * Stream SSE status kalibrasi per batch.
 *
 * Yang dijaga: perangkat lain menerima state kalibrasi (dan jam server) tanpa
 * menunggu polling 15 detik, dan grup yang di-reset dikirim sebagai `null`
 * sehingga kembali ke "belum dimulai" di semua perangkat.
 */

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs: number
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes(needle)) break;
  }
  return buf;
}

const tag = `calib-stream-${Date.now()}`;
const T0 = Date.parse('2026-11-16T02:00:00.000Z');

function request(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Origin', 'http://localhost:3000');
  headers.set('Host', 'localhost:3000');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(url, { ...rest, headers });
}

const ctx = (batchId: string) => ({ params: Promise.resolve({ batchId }) });

describe('SSE status kalibrasi per batch', () => {
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let batchId = '';
  let groupId = '';

  before(async () => {
    const passwordHash = await hashPassword('PasswordSecret123!');
    const admin = await prisma.user.create({
      data: { email: `${tag}-admin@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `${tag}-viewer@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);

    const adminSession = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(adminSession.rawToken, adminSession.expiresAt).split(';')[0];
    const viewerSession = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(viewerSession.rawToken, viewerSession.expiresAt).split(';')[0];

    const seed = Date.now() % 90;
    for (let attempt = 0; attempt < 20 && batchId === ''; attempt += 1) {
      const candidate = `BT-20261116-${String(10 + ((seed + attempt) % 90)).padStart(2, '0')}`;
      try {
        const created = await prisma.collectionBatch.create({
          data: {
            batchId: candidate,
            procuredAtUtc: new Date('2026-11-16T00:30:00.000Z'),
            departedAtUtc: new Date('2026-11-16T00:00:00.000Z'),
            marketSource: 'Pasar Stream Kalibrasi',
            shrimpCount: 8,
            sizeGrade: 25,
            totalWeightG: 320,
            initialCondition: 'DEAD',
            initialTempC: 8,
            arrivedAtUtc: new Date('2026-11-16T01:00:00.000Z'),
            coolerTempMarketC: 1,
            coolerTempLabC: 3,
            operatorId: admin.id,
          },
        });
        batchId = created.batchId;
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    assert.ok(batchId, 'batch uji harus berhasil dibuat');

    const group = await prisma.sampleGroup.create({
      data: {
        groupId: `${batchId}-SR`,
        batchId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25,
        visualCheck: 'NORMAL',
        sampleShrimpCount: 4,
      },
    });
    groupId = group.groupId;

    // Jam server dipatok: `serverTimeUtc` di payload bisa diuji persis.
    setClockForTests(() => T0);
  });

  after(async () => {
    setClockForTests(null);
    await prisma.groupCalibration.deleteMany({ where: { batchId } });
    await prisma.sampleGroup.deleteMany({ where: { batchId } });
    await prisma.collectionBatch.deleteMany({ where: { batchId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. tanpa login ditolak 401, batch tak dikenal 404', async () => {
    const anonymous = await getStream(
      request(`http://localhost:3000/api/v1/batches/${batchId}/calibration/stream`),
      ctx(batchId)
    );
    assert.strictEqual(anonymous.status, 401);

    const missing = await getStream(
      request('http://localhost:3000/api/v1/batches/BT-XXXXXXXX-99/calibration/stream', {
        cookie: adminCookie,
      }),
      ctx('BT-XXXXXXXX-99')
    );
    assert.strictEqual(missing.status, 404);
  });

  it('2. koneksi dibuka dengan snapshot semua grup + jam server', async () => {
    const res = await getStream(
      request(`http://localhost:3000/api/v1/batches/${batchId}/calibration/stream`, {
        cookie: viewerCookie,
      }),
      ctx(batchId)
    );
    assert.strictEqual(res.status, 200, 'VIEWER boleh membaca (state sama dengan detail batch)');
    assert.ok((res.headers.get('content-type') ?? '').includes('text/event-stream'));
    assert.ok(res.body, 'stream wajib punya body');
    const reader = res.body.getReader();
    try {
      const buf = await readUntil(reader, 'event: snapshot', 8000);
      assert.ok(buf.includes('event: snapshot'), 'wajib dibuka dengan snapshot');
      assert.ok(buf.includes(groupId), 'snapshot memuat semua grup batch');
      assert.ok(buf.includes('"calibrations"'));
      assert.ok(buf.includes(`"serverTimeUtc":"${new Date(T0).toISOString()}"`), 'jam server ikut dikirim');
    } finally {
      await reader.cancel();
    }
  });

  it('3. kalibrasi yang dimulai di perangkat lain langsung didorong sebagai state baru', async () => {
    const res = await getStream(
      request(`http://localhost:3000/api/v1/batches/${batchId}/calibration/stream`, {
        cookie: adminCookie,
      }),
      ctx(batchId)
    );
    assert.ok(res.body);
    const reader = res.body.getReader();
    try {
      const opened = await readUntil(reader, 'event: snapshot', 8000);
      assert.ok(opened.includes('event: snapshot'));

      // Aksi dari "perangkat lain" (sesi login berbeda, akun sama).
      const started = await putCalibration(
        request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
          method: 'PUT',
          cookie: adminCookie,
          headers: { 'Content-Type': 'application/json', 'X-Operator': 'Budi' },
          body: JSON.stringify({ action: 'start', durations: [30, 5] }),
        }),
        { params: Promise.resolve({ groupId }) }
      );
      assert.strictEqual(started.status, 200);

      const pushed = await readUntil(reader, 'event: state', 8000);
      assert.ok(pushed.includes('event: state'), 'perubahan kalibrasi wajib didorong');
      assert.ok(pushed.includes('"version":1'), 'state baru membawa versi terbaru');
      assert.ok(pushed.includes('"updatedByOperator":"Budi"'), 'pelaku tercatat ikut terkirim');
      assert.ok(pushed.includes('"completedAtUtc":null'), 'kalibrasi belum selesai');
    } finally {
      await reader.cancel();
    }
  });

  it('4. reset didorong sebagai null sehingga perangkat lain kembali terkunci', async () => {
    const res = await getStream(
      request(`http://localhost:3000/api/v1/batches/${batchId}/calibration/stream`, {
        cookie: adminCookie,
      }),
      ctx(batchId)
    );
    assert.ok(res.body);
    const reader = res.body.getReader();
    try {
      const opened = await readUntil(reader, 'event: snapshot', 8000);
      assert.ok(opened.includes('"version":1'), 'snapshot awal memuat kalibrasi yang masih berjalan');

      const reset = await deleteCalibration(
        request(`http://localhost:3000/api/v1/groups/${groupId}/calibration`, {
          method: 'DELETE',
          cookie: adminCookie,
          headers: { 'X-Operator': 'Budi' },
        }),
        { params: Promise.resolve({ groupId }) }
      );
      assert.strictEqual(reset.status, 200);

      const pushed = await readUntil(reader, 'event: state', 8000);
      assert.ok(pushed.includes('event: state'));
      assert.match(pushed, new RegExp(`"${groupId}":null`), 'grup tanpa kalibrasi dikirim null');
    } finally {
      await reader.cancel();
    }
  });
});
