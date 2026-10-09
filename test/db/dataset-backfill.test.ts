/**
 * Integration Test: Backfill reading ↔ session (Fase 6, PRD §1 kriteria #1/#5).
 * Tanpa menyentuh worker: UPDATE tunggal menautkan row NULL dalam window sesi.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { backfillSessionReadings } from '../../lib/dataset/backfill.ts';

const runId = randomUUID().slice(0, 8);
const BATCH = 'BT-20990505-01';
const GROUP_SR = `${BATCH}-SR`;
const START = new Date('2099-05-05T06:00:00.000Z');

let deviceId = '';
let chamberId = '';
let assignmentId = '';
let sessionId = '';
let emptySessionId = '';
let skippedSessionId = '';

async function makeReading(deviceId: string, chamberId: string, tag: string, measuredAt: Date, seq: number) {
  return prisma.sensorReading.create({
    data: {
      deviceId,
      chamberId,
      assignmentId,
      historySequence: await allocateHistorySequence(),
      messageId: `${tag}-${runId}-${seq}`,
      payloadSha256: `${tag}${runId}${seq}`.padEnd(64, '0').slice(0, 64),
      bootId: randomUUID(),
      sequence: BigInt(seq),
      measuredAt,
      measurementTimeQuality: 'SYNCED',
      temperatureC: 25.3,
      temperatureQuality: 'OK',
      humidityPercent: 68.5,
      humidityQuality: 'OK',
      mq137Raw: 1.8,
      mq137Quality: 'OK',
      mq136Raw: 0.9,
      mq136Quality: 'OK',
      mq4Raw: 1.1,
      mq4Quality: 'OK',
      rawPayload: { test: true },
    },
  });
}

describe('Dataset Backfill Session Readings (Fase 6)', () => {
  before(async () => {
    const user = await prisma.user.create({
      data: { email: `backfill-${runId}@example.local`, passwordHash: 'x', role: 'ADMIN' },
    });
    const device = await prisma.device.create({
      data: { mqttDeviceId: `backfill-${runId}`, name: 'Backfill Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `BF-${runId}`, name: 'Backfill Chamber' },
    });
    chamberId = chamber.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceId, chamberId, activeFrom: new Date('2099-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;

    await prisma.collectionBatch.create({
      data: {
        batchId: BATCH,
        procuredAtUtc: new Date('2099-05-05T00:30:00.000Z'),
        marketSource: 'Pasar Backfill',
        sourceType: 'MARKET',
        shrimpCount: 12,
        // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
        sizeGrade: 25, // Math.round(12 / 485.5 * 1000)
        shrimpLengthCm: 12.5,
        totalWeightG: 485.5,
        initialCondition: 'DEAD',
        initialTempC: 8.2,
        arrivedAtUtc: new Date('2099-05-05T02:00:00.000Z'),
        coolerTempMinC: 1.2,
        coolerTempMaxC: 3.8,
        operatorId: user.id,
      },
    });
    await prisma.sampleGroup.create({
      data: {
        groupId: GROUP_SR,
        batchId: BATCH,
        chamberId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25.0,
        labTempC: 6.5,
        visualCheck: 'NORMAL',
        labWeightBeforeG: 482.0,
        labWeightAfterG: 478.5,
        sampleShrimpCount: 4,
      },
    });
    const endedAt = new Date(START.getTime() + 15 * 60_000);
    const session = await prisma.measurementSession.create({
      data: {
        sessionId: `SES-20990505-H0-SR-${runId}`,
        groupId: GROUP_SR,
        batchId: BATCH,
        chamberId,
        deviceId,
        timepointCode: 'H0',
        elapsedHours: 0,
        startedAtUtc: START,
        endedAtUtc: endedAt,
        warmupDone: true,
        cleaningDone: true,
      },
    });
    sessionId = session.id;

    // 130 row @1Hz: 120 baseline (<120s) + 10 sampel
    for (let s = 0; s < 130; s += 1) {
      await makeReading(deviceId, chamberId, 'bf', new Date(START.getTime() + s * 1000), s);
    }
    // 2 row di luar window: tidak boleh tersentuh
    await makeReading(deviceId, chamberId, 'out', new Date(START.getTime() - 3_600_000), 1000);
    await makeReading(deviceId, chamberId, 'out', new Date(START.getTime() + 3_600_000), 1001);

    // Sesi window kosong ( chamber+device, tanpa reading di dalamnya)
    const empty = await prisma.measurementSession.create({
      data: {
        sessionId: `SES-20990505-H6-SR-${runId}`,
        groupId: GROUP_SR,
        batchId: BATCH,
        chamberId,
        deviceId,
        timepointCode: 'H6',
        elapsedHours: 6,
        startedAtUtc: new Date('2099-06-05T06:00:00.000Z'),
        endedAtUtc: new Date('2099-06-05T06:15:00.000Z'),
        warmupDone: true,
        cleaningDone: true,
      },
    });
    emptySessionId = empty.id;

    // Sesi tanpa chamber/device: dilewati
    const skipped = await prisma.measurementSession.create({
      data: {
        sessionId: `SES-20990505-D1-SR-${runId}`,
        groupId: GROUP_SR,
        batchId: BATCH,
        timepointCode: 'D1',
        elapsedHours: 24,
        startedAtUtc: new Date('2099-05-06T06:00:00.000Z'),
        endedAtUtc: new Date('2099-05-06T06:15:00.000Z'),
        warmupDone: true,
        cleaningDone: true,
      },
    });
    skippedSessionId = skipped.id;
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { batchId: BATCH } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: BATCH } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: BATCH } });
    await prisma.deviceAssignment.deleteMany({ where: { id: assignmentId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.user.deleteMany({ where: { email: `backfill-${runId}@example.local` } });
    await closeDb();
  });

  it('1. Backfill menautkan 130 row dengan split 120 baseline + 10 sampel', async () => {
    const result = await backfillSessionReadings(sessionId);
    assert.strictEqual(result.linked, 130);
    assert.strictEqual(result.baseline, 120);
    assert.strictEqual(result.skipped, false);

    const session = await prisma.measurementSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.strictEqual(session.status, 'COMPLETE');
    assert.strictEqual(Number(session.baselineMq137), 1.8);
    assert.strictEqual(Number(session.baselineMq136), 0.9);
    assert.strictEqual(Number(session.baselineMq4), 1.1);

    const sample = await prisma.sensorReading.findFirstOrThrow({
      where: { messageId: `bf-${runId}-125` },
    });
    assert.strictEqual(sample.batchId, BATCH);
    assert.strictEqual(sample.timepointCode, 'H0');
    assert.strictEqual(sample.isBaseline, false);

    const base = await prisma.sensorReading.findFirstOrThrow({
      where: { messageId: `bf-${runId}-10` },
    });
    assert.strictEqual(base.isBaseline, true);
  });

  it('2. Rerun idempoten: tidak ada row baru tertaut, status tetap COMPLETE', async () => {
    const again = await backfillSessionReadings(sessionId);
    assert.strictEqual(again.linked, 0);
    assert.strictEqual(again.baseline, 120);
    const session = await prisma.measurementSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.strictEqual(session.status, 'COMPLETE');
  });

  it('3. Row di luar window tidak tersentuh (session_id tetap NULL)', async () => {
    const outs = await prisma.sensorReading.findMany({ where: { messageId: { startsWith: 'out' } } });
    assert.strictEqual(outs.length, 2);
    for (const r of outs) {
      assert.strictEqual(r.sessionId, null);
      assert.strictEqual(r.batchId, null);
    }
  });

  it('4. Window kosong → INCOMPLETE; tanpa chamber/device → dilewati COMPLETE', async () => {
    const empty = await backfillSessionReadings(emptySessionId);
    assert.strictEqual(empty.linked, 0);
    const emptyRow = await prisma.measurementSession.findUniqueOrThrow({ where: { id: emptySessionId } });
    assert.strictEqual(emptyRow.status, 'INCOMPLETE');

    const skipped = await backfillSessionReadings(skippedSessionId);
    assert.strictEqual(skipped.skipped, true);
    const skippedRow = await prisma.measurementSession.findUniqueOrThrow({ where: { id: skippedSessionId } });
    assert.strictEqual(skippedRow.status, 'COMPLETE');
  });
});
