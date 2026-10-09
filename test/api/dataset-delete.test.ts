import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { DELETE as deleteBatch } from '../../app/api/v1/batches/[batchId]/route.ts';
import { POST as bulkDelete } from '../../app/api/v1/batches/bulk-delete/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const runId = randomUUID().slice(0, 8);
const DAY = '2099-10-10';
const PREFIX = 'BT-20991010';

function headers(cookie: string): Record<string, string> {
  return { Cookie: cookie, Origin: 'http://localhost:3000', Host: 'localhost:3000' };
}

async function callDelete(batchId: string, cookie: string, force = false) {
  const res = await deleteBatch(
    new Request(`http://localhost:3000/api/v1/batches/${batchId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
      headers: headers(cookie),
    }),
    { params: Promise.resolve({ batchId }) }
  );
  return { status: res.status, body: await res.json() };
}

async function batchData(suffix: string, operatorId: string) {
  return prisma.collectionBatch.create({
    data: {
      batchId: `${PREFIX}-${suffix}`,
      procuredAtUtc: new Date(`${DAY}T00:30:00.000Z`),
      marketSource: 'Pasar Hapus',
      sourceType: 'MARKET',
      shrimpCount: 12,
      // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
      sizeGrade: 30, // Math.round(12 / 400 * 1000)
      shrimpLengthCm: 12.5,
      totalWeightG: 400,
      initialCondition: 'DEAD',
      initialTempC: 8,
      arrivedAtUtc: new Date(`${DAY}T02:00:00.000Z`),
      coolerTempMinC: 1,
      coolerTempMaxC: 3,
      operatorId,
    },
  });
}

describe('HTTP API v1: Dataset Batch Delete Single & Bulk', () => {
  let adminCookie = '';
  let viewerCookie = '';
  const userIds: string[] = [];
  let operatorId = '';
  let deviceId = '';
  let chamberId = '';
  let assignmentId = '';

  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `del-admin-${runId}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `del-viewer-${runId}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    operatorId = admin.id;
    const a = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(a.rawToken, a.expiresAt).split(';')[0];
    const v = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(v.rawToken, v.expiresAt).split(';')[0];

    const device = await prisma.device.create({
      data: { mqttDeviceId: `del-${runId}`, name: 'Delete Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `DEL-${runId}`, name: 'Delete Chamber' },
    });
    chamberId = chamber.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceId, chamberId, activeFrom: new Date('2099-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: { startsWith: PREFIX } } });
    await prisma.deviceAssignment.deleteMany({ where: { id: assignmentId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. DELETE batch kosong → 200 dan grup/sesi ikut hilang', async () => {
    const batch = await batchData('01', operatorId);
    await prisma.sampleGroup.create({
      data: {
        groupId: `${batch.batchId}-SR`,
        batchId: batch.batchId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25,
        labTempC: 6,
        visualCheck: 'NORMAL',
        labWeightBeforeG: 400,
        labWeightAfterG: 395.5,
        sampleShrimpCount: 4,
      },
    });

    const { status, body } = await callDelete(batch.batchId, adminCookie);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.deleted, true);
    assert.strictEqual(await prisma.collectionBatch.count({ where: { batchId: batch.batchId } }), 0);
    assert.strictEqual(await prisma.sampleGroup.count({ where: { batchId: batch.batchId } }), 0);
  });

  it('2. DELETE batch ber-reading ditolak 409, force=true memutus tautan', async () => {
    const batch = await batchData('02', operatorId);
    await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        historySequence: await allocateHistorySequence(),
        messageId: `delink-${runId}`,
        payloadSha256: `delink${runId}`.padEnd(64, '0').slice(0, 64),
        bootId: randomUUID(),
        sequence: 1n,
        measuredAt: new Date('2099-10-10T06:00:00.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureC: 25,
        temperatureQuality: 'OK',
        humidityPercent: 60,
        humidityQuality: 'OK',
        mq137Quality: 'SENSOR_ERROR',
        mq136Quality: 'SENSOR_ERROR',
        mq4Quality: 'SENSOR_ERROR',
        rawPayload: { test: true },
        batchId: batch.batchId,
        timepointCode: 'H0',
        isBaseline: false,
      },
    });

    const refused = await callDelete(batch.batchId, adminCookie);
    assert.strictEqual(refused.status, 409);
    assert.ok(refused.body.error.message.includes('1 data tertaut'));

    const forced = await callDelete(batch.batchId, adminCookie, true);
    assert.strictEqual(forced.status, 200);
    assert.strictEqual(forced.body.data.unlinkedReadings, 1);
    const reading = await prisma.sensorReading.findFirstOrThrow({
      where: { messageId: `delink-${runId}` },
    });
    assert.strictEqual(reading.batchId, null);
    assert.strictEqual(reading.sessionId, null);
    assert.strictEqual(reading.timepointCode, null);
  });

  it('3. DELETE batch terkunci/tidak ada ditolak; auth matrix dijaga', async () => {
    const batch = await batchData('03', operatorId);
    await prisma.collectionBatch.update({
      where: { batchId: batch.batchId },
      data: { lockedAt: new Date() },
    });
    assert.strictEqual((await callDelete(batch.batchId, adminCookie)).status, 409);
    assert.strictEqual((await callDelete(batch.batchId, adminCookie, true)).status, 409);
    await prisma.collectionBatch.update({ where: { batchId: batch.batchId }, data: { lockedAt: null } });
    assert.strictEqual((await callDelete(batch.batchId, adminCookie)).status, 200);

    assert.strictEqual((await callDelete('BT-20991010-99', adminCookie)).status, 404);

    const target = await batchData('04', operatorId);
    const viewer = await deleteBatch(
      new Request(`http://localhost:3000/api/v1/batches/${target.batchId}`, {
        method: 'DELETE',
        headers: headers(viewerCookie),
      }),
      { params: Promise.resolve({ batchId: target.batchId }) }
    );
    assert.strictEqual(viewer.status, 403);

    const anon = await deleteBatch(
      new Request(`http://localhost:3000/api/v1/batches/${target.batchId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ batchId: target.batchId }) }
    );
    assert.strictEqual(anon.status, 401);
    await prisma.collectionBatch.delete({ where: { batchId: target.batchId } });
  });

  it('4. POST bulk-delete memproses per batch (campuran sukses/gagal)', async () => {
    const okBatch = await batchData('05', operatorId);
    const locked = await batchData('06', operatorId);
    await prisma.collectionBatch.update({
      where: { batchId: locked.batchId },
      data: { lockedAt: new Date() },
    });

    const callBulk = (payload: unknown, cookie: string) =>
      bulkDelete(
        new Request('http://localhost:3000/api/v1/batches/bulk-delete', {
          method: 'POST',
          headers: { ...headers(cookie), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );

    const res = await callBulk(
      { batchIds: [okBatch.batchId, locked.batchId, 'BT-20991010-99'] },
      adminCookie
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.meta.total, 3);
    assert.strictEqual(body.meta.deleted, 1);
    assert.strictEqual(body.meta.failed, 2);
    assert.strictEqual(body.data[0].deleted, true);
    assert.ok(body.data[1].error.includes('terkunci'));
    assert.ok(body.data[2].error.includes('not found'));

    assert.strictEqual(
      (await callBulk({ batchIds: [] }, adminCookie)).status,
      422
    );
    assert.strictEqual(
      (await callBulk({ batchIds: [okBatch.batchId] }, viewerCookie)).status,
      403
    );

    await prisma.collectionBatch.update({ where: { batchId: locked.batchId }, data: { lockedAt: null } });
    await prisma.collectionBatch.delete({ where: { batchId: locked.batchId } });
  });
});
