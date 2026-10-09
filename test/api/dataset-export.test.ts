import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { GET as exportBatch } from '../../app/api/v1/batches/[batchId]/export/route.ts';
import { DATASET_CSV_HEADERS } from '../../lib/api/csv.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const runId = randomUUID().slice(0, 8);
const BATCH = 'BT-20990606-01';
const GROUP = `${BATCH}-SR`;
const SESSION = `SES-20990606-H0-SR`;

let viewerCookie = '';
let deviceId = '';
let chamberId = '';
let assignmentId = '';
let sessionUuid = '';
const userIds: string[] = [];

async function makeReading(tag: string, measuredAt: Date, baseline: boolean, nullMq136: boolean) {
  return prisma.sensorReading.create({
    data: {
      deviceId,
      chamberId,
      assignmentId,
      historySequence: await allocateHistorySequence(),
      messageId: `${tag}-${runId}`,
      payloadSha256: `${tag}${runId}`.padEnd(64, '0').slice(0, 64),
      bootId: randomUUID(),
      sequence: BigInt(Math.floor(Math.random() * 1_000_000)),
      measuredAt,
      measurementTimeQuality: 'SYNCED',
      temperatureC: 25.3,
      temperatureQuality: 'OK',
      humidityPercent: 68.5,
      humidityQuality: 'OK',
      mq137Raw: 1.842,
      mq137Quality: 'OK',
      mq136Raw: nullMq136 ? null : 0.915,
      mq136Quality: nullMq136 ? 'SENSOR_ERROR' : 'OK',
      mq4Raw: 1.103,
      mq4Quality: 'OK',
      rawPayload: { test: true },
      sessionId: sessionUuid,
      batchId: BATCH,
      timepointCode: 'H0',
      isBaseline: baseline,
    },
  });
}

function getExport(query = '') {
  return exportBatch(
    new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export${query}`, {
      headers: { Cookie: viewerCookie },
    }),
    { params: Promise.resolve({ batchId: BATCH }) }
  );
}

describe('HTTP API v1: Dataset Batch CSV Export (Fase 7)', () => {
  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `export-admin-${runId}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `export-viewer-${runId}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const v = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(v.rawToken, v.expiresAt).split(';')[0];

    const device = await prisma.device.create({
      data: { mqttDeviceId: `export-${runId}`, name: 'Export Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `EXP-${runId}`, name: 'Export Chamber' },
    });
    chamberId = chamber.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceId, chamberId, activeFrom: new Date('2099-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;

    await prisma.collectionBatch.create({
      data: {
        batchId: BATCH,
        procuredAtUtc: new Date('2099-06-06T00:30:00.000Z'),
        marketSource: 'Pasar Export',
        sourceType: 'MARKET',
        shrimpCount: 12,
        // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
        sizeGrade: 25, // Math.round(12 / 485.5 * 1000)
        shrimpLengthCm: 12.5,
        totalWeightG: 485.5,
        initialCondition: 'DEAD',
        initialTempC: 8.2,
        arrivedAtUtc: new Date('2099-06-06T02:00:00.000Z'),
        coolerTempMinC: 1.2,
        coolerTempMaxC: 3.8,
        tempStartC: 3.0,
        tempEndC: 3.5,
        operatorId: admin.id,
      },
    });
    await prisma.sampleGroup.create({
      data: {
        groupId: GROUP,
        batchId: BATCH,
        chamberId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25.0,
        labTempC: 6.5,
        visualCheck: 'NORMAL',
        labWeightG: 482.0,
        shrimpLengthCm: 12.4,
        sampleShrimpCount: 4,
        sampleWeightG: 162.3,
      },
    });
    // Grup dingin tanpa sesi — menguji baris 'no_session' pada metadata.
    await prisma.sampleGroup.create({
      data: {
        groupId: `${BATCH}-SD`,
        batchId: BATCH,
        storageCondition: 'COLD',
        targetTempC: 4.0,
        labTempC: 5.0,
        visualCheck: 'NORMAL',
        labWeightG: 480.0,
        shrimpLengthCm: 12.6,
        sampleShrimpCount: 4,
        sampleWeightG: 160.0,
      },
    });
    const session = await prisma.measurementSession.create({
      data: {
        sessionId: SESSION,
        groupId: GROUP,
        batchId: BATCH,
        chamberId,
        deviceId,
        timepointCode: 'H0',
        elapsedHours: 0,
        startedAtUtc: new Date('2099-06-06T06:00:00.000Z'),
        endedAtUtc: new Date('2099-06-06T06:15:00.000Z'),
        warmupDone: true,
        cleaningDone: true,
        status: 'COMPLETE',
      },
    });
    sessionUuid = session.id;

    await makeReading('exp-base', new Date('2099-06-06T06:00:30.000Z'), true, false);
    await makeReading('exp-null', new Date('2099-06-06T06:01:00.000Z'), true, true);
    await makeReading('exp-sample', new Date('2099-06-06T06:05:00.000Z'), false, false);
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { id: sessionUuid } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: BATCH } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: BATCH } });
    await prisma.deviceAssignment.deleteMany({ where: { id: assignmentId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. Export menghasilkan header persis PRD dan row ML-ready', async () => {
    const res = await getExport();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`dataset-${BATCH}\\.csv`));

    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines[0], DATASET_CSV_HEADERS.join(','));
    assert.strictEqual(lines.length, 4); // header + 3 row

    const base = lines[1].split(',');
    assert.strictEqual(base[0], '2099-06-06T06:00:30.000Z');
    assert.strictEqual(base[1], SESSION);
    assert.strictEqual(base[2], BATCH);
    assert.strictEqual(base[3], 'market');
    assert.strictEqual(base[4], 'room_temp');
    assert.strictEqual(base[5], 'H0');
    assert.strictEqual(base[6], '0');
    assert.strictEqual(base[7], '1.842');
    assert.strictEqual(base[12], 'true');

    const nullRow = lines[2].split(',');
    assert.strictEqual(nullRow[8], ''); // mq136 null → sel kosong, bukan 0
    assert.strictEqual(nullRow[12], 'true');

    const sampleRow = lines[3].split(',');
    assert.strictEqual(sampleRow[12], 'false');
  });

  it('2. Filter sessionId, timepointCode, dan isBaseline', async () => {
    const bySession = await getExport(`?sessionId=${SESSION}`);
    assert.strictEqual((await bySession.text()).split('\r\n').filter((l) => l.length > 0).length, 4);

    const byTimepoint = await getExport('?timepointCode=H0');
    assert.strictEqual((await byTimepoint.text()).split('\r\n').filter((l) => l.length > 0).length, 4);

    const baselineOnly = await getExport('?isBaseline=true');
    assert.strictEqual((await baselineOnly.text()).split('\r\n').filter((l) => l.length > 0).length, 3);

    const badFlag = await exportBatch(
      new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export?isBaseline=mungkin`, {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ batchId: BATCH }) }
    );
    assert.strictEqual(badFlag.status, 422);

    const unknownSession = await getExport('?sessionId=SES-TIDAK-ADA');
    assert.strictEqual(unknownSession.status, 404);
  });

  it('3. Batch tidak ada 404, tanpa auth 401', async () => {
    const missing = await exportBatch(
      new Request('http://localhost:3000/api/v1/batches/BT-20990606-99/export', {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ batchId: 'BT-20990606-99' }) }
    );
    assert.strictEqual(missing.status, 404);

    const anon = await exportBatch(
      new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export`),
      { params: Promise.resolve({ batchId: BATCH }) }
    );
    assert.strictEqual(anon.status, 401);
  });

  it('4. format=metadata membawa isian form (satu baris per sesi + no_session)', async () => {
    const res = await getExport('?format=metadata');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /metadata-.*\.csv/);
    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines[0].split(',')[0], 'batch_id');
    assert.strictEqual(lines.length, 3); // header + SR (punya sesi) + SD (no_session)

    const sr = lines.find((l) => l.includes(GROUP))!.split(',');
    assert.strictEqual(sr[0], BATCH);
    assert.strictEqual(sr[2], 'Pasar Export');
    assert.strictEqual(sr[6], '12.5'); // shrimp_length_cm batch
    assert.strictEqual(sr[7], '485.5');
    assert.strictEqual(sr[19], GROUP);
    assert.strictEqual(sr[20], 'room_temp');
    assert.strictEqual(sr[24], '482');
    assert.strictEqual(sr[25], '12.4'); // shrimp_length_cm grup
    assert.strictEqual(sr[27], '162.3');
    assert.strictEqual(sr[28], SESSION);
    assert.strictEqual(sr[30], '0');
    assert.strictEqual(sr[33], 'complete');
    assert.strictEqual(sr[34], 'true');

    const sd = lines.find((l) => l.includes(`${BATCH}-SD`))!.split(',');
    assert.strictEqual(sd[19], `${BATCH}-SD`);
    assert.strictEqual(sd[20], 'cold');
    assert.strictEqual(sd[25], '12.6'); // shrimp_length_cm grup dingin
    assert.strictEqual(sd[28], ''); // session_id kosong
    assert.strictEqual(sd[33], 'no_session'); // ditandai jelas
  });

  it('5. format tidak dikenal ditolak 422', async () => {
    const res = await getExport('?format=pdf');
    assert.strictEqual(res.status, 422);
  });
});
