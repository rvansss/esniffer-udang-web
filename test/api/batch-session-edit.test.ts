import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { wibInputToUtcIso } from '../../lib/batch-wizard.ts';
import { POST as createBatch } from '../../app/api/v1/batches/route.ts';
import { POST as createGroups } from '../../app/api/v1/batches/[batchId]/groups/route.ts';
import { POST as lockBatch } from '../../app/api/v1/batches/[batchId]/lock/route.ts';
import { GET as getBatchDetail } from '../../app/api/v1/batches/[batchId]/route.ts';
import { POST as uploadPhotos } from '../../app/api/v1/batches/[batchId]/photos/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { PATCH as patchBatch } from '../../app/api/v1/batches/[batchId]/route.ts';
import { PATCH as patchSession } from '../../app/api/v1/sessions/[sessionId]/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

// Koreksi data pencatatan: PATCH batch (form edit semua bagian di halaman
// detail), PATCH sesi (ikon pensil di tabel riwayat dinamis), foto per sesi.

const DAY = '2099-03-03';
const DEPARTED = `${DAY}T00:00:00.000Z`; // 07:00 WIB
const PROCURED = `${DAY}T00:30:00.000Z`; // 07:30 WIB
const ARRIVED = `${DAY}T01:00:00.000Z`; // 08:00 WIB

function jsonHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    Origin: 'http://localhost:3000',
    Host: 'localhost:3000',
    'Content-Type': 'application/json',
  };
}

function batchBody(overrides: Record<string, unknown> = {}) {
  return {
    departedAtUtc: DEPARTED,
    procuredAtUtc: PROCURED,
    marketSource: 'Pasar Bebas Ketik Manual',
    sourceType: 'market',
    shrimpCount: 12,
    shrimpLengthCm: 12.5,
    totalWeightG: 485.5,
    initialCondition: 'dead',
    initialTempC: 2.5,
    arrivedAtUtc: ARRIVED,
    coolerTempDepartureC: 1.0,
    coolerTempMarketC: 1.2,
    coolerTempLabC: 3.8,
    ...overrides,
  };
}

function groupsBody() {
  return {
    groups: [
      {
        storageCondition: 'room_temp',
        labTempC: 6.5,
        visualCheck: 'normal',
        labWeightBeforeG: 482.0,
        labWeightAfterG: 478.5,
        sampleShrimpCount: 4,
      },
      {
        storageCondition: 'cold',
        labTempC: 5.0,
        visualCheck: 'normal',
        labWeightBeforeG: 480.0,
        labWeightAfterG: 476.2,
        sampleShrimpCount: 4,
      },
    ],
  };
}

describe('HTTP API v1: PATCH batch + PATCH sesi + foto per sesi (revisi tabel riwayat)', () => {
  const tag = Date.now().toString().slice(-6);
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let batchId = '';
  let groupSr = '';
  let sessionH0 = '';
  let chamberId = '';
  let deviceId = '';
  let assignmentId = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `batch-edit-admin-${tag}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `batch-edit-viewer-${tag}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const adminSess = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(adminSess.rawToken, adminSess.expiresAt).split(';')[0];
    const viewerSess = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(viewerSess.rawToken, viewerSess.expiresAt).split(';')[0];

    const chamber = await prisma.chamber.create({ data: { code: `EDIT-${tag}`, name: 'Session edit test' } });
    chamberId = chamber.id;
    const device = await prisma.device.create({ data: { mqttDeviceId: `edit-${tag}`, name: 'Session edit test' } });
    deviceId = device.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { chamberId, deviceId, activeFrom: new Date('2026-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;

    const res = await createBatch(
      new Request('http://localhost:3000/api/v1/batches', {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify(batchBody()),
      })
    );
    assert.strictEqual(res.status, 201);
    batchId = (await res.json()).data.batchId;

    const groupsRes = await createGroups(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify(groupsBody()),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(groupsRes.status, 201);
    const groupsJson = await groupsRes.json();
    assert.strictEqual(groupsJson.data.length, 2);
    groupSr = groupsJson.data[0].groupId;

    // Sesi H0 memakai data observasi tahap (kolom baru measurement_sessions).
    const sessionRes = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({
          timepointCode: 'H0',
          warmupDone: true,
          shrimpTempC: 4.5,
          shrimpWeightG: 500.1,
        }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(sessionRes.status, 201);
    const sessionBody = await sessionRes.json();
    assert.strictEqual(sessionBody.data.shrimpTempC, 4.5);
    assert.strictEqual(sessionBody.data.shrimpWeightG, 500.1);
    sessionH0 = sessionBody.data.sessionId;
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.batchPhoto.deleteMany({ where: { batchId: { startsWith: 'BT-20990303' } } });
    await prisma.measurementSession.deleteMany({ where: { batchId: { startsWith: 'BT-20990303' } } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: { startsWith: 'BT-20990303' } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: { startsWith: 'BT-20990303' } } });
    await rm(path.join(process.cwd(), 'public', 'uploads', 'BT-20990303-01'), { recursive: true, force: true });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await closeDb();
  });

  it('1. POST sesi menolak suhu di luar -2..30 (422)', async () => {
    const res = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({ timepointCode: 'H6', warmupDone: true, shrimpTempC: 99 }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(res.status, 422);
  });

  it('1b. POST sesi dengan rentang waktu masa lalu (autoBackfill) otomatis selesai dan mengembalikan data', async () => {
    const reading = await prisma.sensorReading.create({
      data: {
        chamberId, deviceId, assignmentId,
        messageId: `range-${tag}`, payloadSha256: 'a'.repeat(64),
        bootId: randomUUID(), sequence: 1n,
        measuredAt: new Date('2026-10-24T13:10:15.000Z'),
        measurementTimeQuality: 'SYNCED',
        historySequence: await allocateHistorySequence(),
        temperatureC: 25, temperatureQuality: 'OK',
        humidityPercent: 65, humidityQuality: 'OK',
        mq137Raw: 100, mq137Quality: 'OK',
        mq136Raw: 200, mq136Quality: 'OK',
        mq4Raw: 300, mq4Quality: 'OK', rawPayload: {},
      },
    });
    const res = await createSession(
      new Request(`http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({
          timepointCode: 'H6',
          chamberId,
          startedAtUtc: wibInputToUtcIso('2026-10-24T20:10'),
          endedAtUtc: wibInputToUtcIso('2026-10-24T20:11'),
          durationSeconds: 60,
          autoBackfill: true,
          shrimpTempC: 5.5,
          shrimpWeightG: 480.0,
        }),
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.data.timepointCode, 'H6');
    assert.strictEqual(body.data.durationSeconds, 60);
    assert.strictEqual(body.data.status, 'complete');
    assert.strictEqual(body.data.cleaningDone, true);
    assert.strictEqual(body.data.warmupDone, true);
    assert.strictEqual(body.data.shrimpTempC, 5.5);
    assert.strictEqual(body.data.shrimpWeightG, 480.0);
    assert.ok(body.meta);
    assert.strictEqual(body.meta.linkedReadings, 1);
    const linked = await prisma.sensorReading.findUniqueOrThrow({ where: { id: reading.id } });
    assert.strictEqual(linked.sessionId, body.data.id);
    assert.strictEqual(linked.timepointCode, 'H6');
  });

  it('2. PATCH /sessions/:id memperbarui dan mengosongkan suhu/berat (200)', async () => {
    const update = await patchSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({ shrimpTempC: 7.25, shrimpWeightG: null }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(update.status, 200);
    const body = await update.json();
    assert.strictEqual(body.data.shrimpTempC, 7.25);
    assert.strictEqual(body.data.shrimpWeightG, null);

    const dbRow = await prisma.measurementSession.findUnique({ where: { sessionId: sessionH0 } });
    assert.strictEqual(dbRow?.shrimpWeightG, null);
  });

  it('3. PATCH /sessions/:id menolak berat nonpositif (422) dan body kosong (422)', async () => {
    const bad = await patchSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({ shrimpWeightG: 0 }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(bad.status, 422);

    const empty = await patchSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(empty.status, 422);
  });

  it('4. PATCH /sessions/:id viewer ditolak 403', async () => {
    const res = await patchSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}`, {
        method: 'PATCH',
        headers: jsonHeaders(viewerCookie),
        body: JSON.stringify({ shrimpTempC: 3 }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(res.status, 403);
  });

  it('5. Foto ditempel ke sesi: sessionId disimpan; sesi asing ditolak', async () => {
    const form = new FormData();
    form.append('photos', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'tahap.jpg', { type: 'image/jpeg' }));
    form.append('captions', JSON.stringify(['Kondisi H0']));
    form.append('sessionId', sessionH0);
    const ok = await uploadPhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
        method: 'POST',
        headers: { Cookie: adminCookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: form,
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(ok.status, 201);

    const link = await prisma.batchPhoto.findFirst({ where: { batchId, sessionId: sessionH0 } });
    assert.ok(link);
    assert.strictEqual(link.caption, 'Kondisi H0');

    const wrongForm = new FormData();
    wrongForm.append('photos', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'salah.jpg', { type: 'image/jpeg' }));
    wrongForm.append('captions', JSON.stringify(['Salah tempat']));
    wrongForm.append('sessionId', `SES-20990303-01-H48-SR`);
    const wrong = await uploadPhotos(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/photos`, {
        method: 'POST',
        headers: { Cookie: adminCookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' },
        body: wrongForm,
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(wrong.status, 404);
  });

  it('6. Detail batch menyertakan shrimpTempC/shrimpWeightG + sessionId foto', async () => {
    const res = await getBatchDetail(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        headers: { Cookie: adminCookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' },
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const session = body.data.sampleGroups[0].sessions.find((s: { sessionId: string }) => s.sessionId === sessionH0);
    assert.strictEqual(session.shrimpTempC, 7.25);
    const photo = body.data.photos.find((p: { sessionId: string | null }) => p.sessionId === sessionH0);
    assert.ok(photo);
  });

  it('7. PATCH /batches/:id koreksi data lengkap + sizeGrade dihitung ulang', async () => {
    const res = await patchBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify(
          batchBody({
            marketSource: 'Supermarket Koreksi',
            sourceType: 'supermarket',
            shrimpCount: 10,
            totalWeightG: 500, // sizeGrade baru = round(10/500*1000) = 20
            initialTempC: 4.0,
          })
        ),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.marketSource, 'Supermarket Koreksi');
    assert.strictEqual(body.data.sourceType, 'supermarket');
    assert.strictEqual(body.data.sizeGrade, 20);
    assert.strictEqual(body.data.initialTempC, 4.0);
    // Nilai yang tidak dikirim tetap dari baris lama (merge, bukan null).
    assert.strictEqual(body.data.coolerTempDepartureC, 1.0);
  });

  it('8. PATCH /batches/:id menolak urutan waktu mundur (422)', async () => {
    const res = await patchBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify(batchBody({ departedAtUtc: `${DAY}T01:30:00.000Z` })), // berangkat setelah tiba
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 422);
  });

  it('9. PATCH /batches/:id viewer ditolak 403', async () => {
    const res = await patchBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        method: 'PATCH',
        headers: jsonHeaders(viewerCookie),
        body: JSON.stringify(batchBody()),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(res.status, 403);
  });

  it('10. Batch terkunci: PATCH batch dan PATCH sesi ditolak 409', async () => {
    // Lock butuh semua sesi selesai: complete H0 dengan cleaning dulu.
    const complete = await completeSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({ cleaningDone: true }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(complete.status, 200);

    const lock = await lockBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/lock`, {
        method: 'POST',
        headers: jsonHeaders(adminCookie),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(lock.status, 200);

    const patchBatchLocked = await patchBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify(batchBody()),
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(patchBatchLocked.status, 409);

    const patchSessionLocked = await patchSession(
      new Request(`http://localhost:3000/api/v1/sessions/${sessionH0}`, {
        method: 'PATCH',
        headers: jsonHeaders(adminCookie),
        body: JSON.stringify({ shrimpTempC: 3 }),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(patchSessionLocked.status, 409);
  });
});
