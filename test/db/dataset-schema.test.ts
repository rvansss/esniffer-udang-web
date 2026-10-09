/**
 * Integration Test: Dataset Schema (Fase 1)
 * PRD §5.4 + §7 kriteria #4: unique/duplikat ditolak, CHECK ditegakkan,
 * kolom baru SensorReading nullable (riwayat lama tetap valid),
 * market_source adalah teks bebas (revisi: bukan dropdown).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';

const runId = randomUUID().slice(0, 8);
const BATCH = `BT-20990101-01`;
const GROUP_SR = `${BATCH}-SR`;
const GROUP_SD = `${BATCH}-SD`;
const SESSION_H0 = `SES-20990101-H0-SR`;

let operatorId: string;
let deviceId: string;
let chamberId: string;

function batchData(overrides: Record<string, unknown> = {}) {
  return {
    batchId: BATCH,
    procuredAtUtc: new Date('2099-01-01T00:30:00.000Z'),
    marketSource: 'Pasar Bebas Ketik Manual',
    sourceType: 'MARKET' as const,
    shrimpCount: 12,
    // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
    sizeGrade: 25, // Math.round(12 / 485.5 * 1000)
    shrimpLengthCm: 12.5,
    totalWeightG: 485.5,
    initialCondition: 'DEAD' as const,
    initialTempC: 8.2,
    departedAtUtc: new Date('2099-01-01T00:15:00.000Z'),
    arrivedAtUtc: new Date('2099-01-01T02:00:00.000Z'),
    coolerTempMinC: 1.2,
    coolerTempMaxC: 3.8,
    tempStartC: 3.0,
    tempEndC: 3.5,
    operatorId,
    ...overrides,
  };
}

describe('Dataset Schema Integrity (Fase 1)', () => {
  before(async () => {
    const user = await prisma.user.create({
      data: {
        email: `dataset-test-${runId}@example.local`,
        passwordHash: 'test-hash-not-for-login',
        role: 'ADMIN',
      },
    });
    operatorId = user.id;

    const device = await prisma.device.create({
      data: { mqttDeviceId: `test-dataset-${runId}`, name: 'Dataset Test Node' },
    });
    deviceId = device.id;

    const chamber = await prisma.chamber.create({
      data: { code: `TST-${runId}`, name: 'Dataset Test Chamber' },
    });
    chamberId = chamber.id;

    await prisma.collectionBatch.create({ data: batchData() });
    await prisma.sampleGroup.create({
      data: {
        groupId: GROUP_SR,
        batchId: BATCH,
        chamberId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25.0,
        labTempC: 6.5,
        visualCheck: 'NORMAL',
        labWeightG: 482.0,
        sampleShrimpCount: 4,
        sampleWeightG: 162.3,
      },
    });
    await prisma.measurementSession.create({
      data: {
        sessionId: SESSION_H0,
        groupId: GROUP_SR,
        batchId: BATCH,
        chamberId,
        deviceId,
        timepointCode: 'H0',
        elapsedHours: 0,
        startedAtUtc: new Date('2099-01-01T06:00:00.000Z'),
        warmupDone: true,
      },
    });
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { OR: [{ batchId: BATCH }, { deviceId }] } });
    await prisma.measurementSession.deleteMany({ where: { batchId: BATCH } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: BATCH } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: BATCH } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.user.deleteMany({ where: { id: operatorId } });
    await closeDb();
  });

  it('relasi batch → group → session tersambung dan terbaca', async () => {
    const batch = await prisma.collectionBatch.findUnique({
      where: { batchId: BATCH },
      include: { sampleGroups: { include: { sessions: true } }, sessions: true },
    });
    assert.ok(batch);
    assert.strictEqual(batch.sampleGroups.length, 1);
    assert.strictEqual(batch.sampleGroups[0].groupId, GROUP_SR);
    assert.strictEqual(batch.sampleGroups[0].sessions[0].sessionId, SESSION_H0);
    assert.strictEqual(batch.sessions[0].timepointCode, 'H0');
  });

  it('market_source menerima teks bebas apa pun (bukan dropdown)', async () => {
    const custom = await prisma.collectionBatch.create({
      data: batchData({ batchId: 'BT-20990101-02', marketSource: 'Pasar Xyz Sembarang 123' }),
    });
    assert.strictEqual(custom.marketSource, 'Pasar Xyz Sembarang 123');
    await prisma.collectionBatch.delete({ where: { batchId: 'BT-20990101-02' } });
  });

  it('duplikat batch_id ditolak (P2002)', async () => {
    await assert.rejects(prisma.collectionBatch.create({ data: batchData() }), (err: unknown) => {
      assert.strictEqual((err as { code?: string }).code, 'P2002');
      return true;
    });
  });

  it('duplikat (batch_id, storage_condition) ditolak (P2002)', async () => {
    await assert.rejects(
      prisma.sampleGroup.create({
        data: {
          groupId: `${BATCH}-SR-DUP`,
          batchId: BATCH,
          storageCondition: 'ROOM_TEMP',
          targetTempC: 25.0,
          labTempC: 6.0,
          visualCheck: 'NORMAL',
          labWeightG: 480.0,
          sampleShrimpCount: 4,
          sampleWeightG: 160.0,
        },
      }),
      (err: unknown) => {
        assert.strictEqual((err as { code?: string }).code, 'P2002');
        return true;
      }
    );
  });

  it('duplikat (group_id, timepoint_code) ditolak (P2002)', async () => {
    await assert.rejects(
      prisma.measurementSession.create({
        data: {
          sessionId: 'SES-20990101-H0-SR-DUP',
          groupId: GROUP_SR,
          batchId: BATCH,
          timepointCode: 'H0',
          elapsedHours: 0,
          startedAtUtc: new Date('2099-01-01T06:00:00.000Z'),
        },
      }),
      (err: unknown) => {
        assert.strictEqual((err as { code?: string }).code, 'P2002');
        return true;
      }
    );
  });

  it('CHECK: shrimp_count < 10 ditolak', async () => {
    await assert.rejects(
      prisma.collectionBatch.create({ data: batchData({ batchId: 'BT-20990101-03', shrimpCount: 5 }) })
    );
  });

  it('CHECK: urutan waktu transport terbalik ditolak', async () => {
    await assert.rejects(
      prisma.collectionBatch.create({
        data: batchData({
          batchId: 'BT-20990101-04',
          departedAtUtc: new Date('2099-01-01T05:00:00.000Z'),
          arrivedAtUtc: new Date('2099-01-01T02:00:00.000Z'),
        }),
      })
    );
  });

  it('CHECK: jam beli di luar rentang berangkat–tiba ditolak', async () => {
    await assert.rejects(
      prisma.collectionBatch.create({
        data: batchData({
          batchId: 'BT-20990101-06',
          procuredAtUtc: new Date('2099-01-01T00:00:00.000Z'), // 07:00 WIB, sebelum berangkat 07:15
        }),
      })
    );
  });

  it('CHECK: suhu cooler di luar 0–4 ditolak', async () => {
    await assert.rejects(
      prisma.collectionBatch.create({
        data: batchData({ batchId: 'BT-20990101-05', coolerTempMaxC: 12.0 }),
      })
    );
  });

  it('CHECK: format batch_id salah ditolak', async () => {
    await assert.rejects(prisma.collectionBatch.create({ data: batchData({ batchId: 'SALAH' }) }));
  });

  it('CHECK: sample_shrimp_count di luar 3–5 ditolak', async () => {
    await assert.rejects(
      prisma.sampleGroup.create({
        data: {
          groupId: `${BATCH}-XX`,
          batchId: BATCH,
          storageCondition: 'COLD',
          targetTempC: 4.0,
          labTempC: 5.0,
          visualCheck: 'NORMAL',
          labWeightG: 480.0,
          sampleShrimpCount: 9,
          sampleWeightG: 300.0,
        },
      })
    );
  });

  it('CHECK: format timepoint_code salah ditolak', async () => {
    await assert.rejects(
      prisma.measurementSession.create({
        data: {
          sessionId: 'SES-20990101-XX',
          groupId: GROUP_SR,
          batchId: BATCH,
          timepointCode: 'KEMARIN',
          elapsedHours: 0,
          startedAtUtc: new Date('2099-01-01T06:00:00.000Z'),
        },
      })
    );
  });

  it('reading lama (kolom dataset NULL) tetap valid + reading baru tertaut sesi', async () => {
    const legacy = await prisma.sensorReading.create({
      data: {
        deviceId,
        messageId: `legacy-${runId}`,
        payloadSha256: 'a'.repeat(64),
        bootId: randomUUID(),
        sequence: 1n,
        measurementTimeQuality: 'UNKNOWN',
        temperatureC: 25.5,
        temperatureQuality: 'OK',
        humidityPercent: 60.0,
        humidityQuality: 'OK',
        mq137Quality: 'SENSOR_ERROR',
        mq136Quality: 'SENSOR_ERROR',
        mq4Quality: 'SENSOR_ERROR',
        rawPayload: { test: true },
      },
    });
    assert.strictEqual(legacy.sessionId, null);
    assert.strictEqual(legacy.batchId, null);

    // SYNCED wajib punya assignment + historySequence (chk_reading_time_quality existing)
    const assignment = await prisma.deviceAssignment.create({
      data: {
        deviceId,
        chamberId,
        activeFrom: new Date('2099-01-01T00:00:00.000Z'),
      },
    });
    const historySequence = await allocateHistorySequence();
    const linked = await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId: assignment.id,
        historySequence,
        messageId: `linked-${runId}`,
        payloadSha256: 'b'.repeat(64),
        bootId: randomUUID(),
        sequence: 2n,
        measuredAt: new Date('2099-01-01T06:02:30.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureC: 25.3,
        temperatureQuality: 'OK',
        humidityPercent: 68.5,
        humidityQuality: 'OK',
        mq137Raw: 1.842,
        mq137Quality: 'OK',
        mq136Raw: 0.915,
        mq136Quality: 'OK',
        mq4Raw: 1.103,
        mq4Quality: 'OK',
        rawPayload: { test: true },
        sessionId: (await prisma.measurementSession.findUnique({ where: { sessionId: SESSION_H0 } }))!.id,
        batchId: BATCH,
        timepointCode: 'H0',
        isBaseline: false,
      },
    });
    const withSession = await prisma.sensorReading.findUnique({
      where: { id: linked.id },
      include: { session: true, batch: true },
    });
    assert.strictEqual(withSession?.session?.sessionId, SESSION_H0);
    assert.strictEqual(withSession?.batch?.batchId, BATCH);
  });

  it(`FK Restrict: batch berisi grup tidak bisa dihapus (isolasi ${GROUP_SD} dipakai di sini)`, async () => {
    await prisma.sampleGroup.create({
      data: {
        groupId: GROUP_SD,
        batchId: BATCH,
        storageCondition: 'COLD',
        targetTempC: 4.0,
        labTempC: 5.0,
        visualCheck: 'NORMAL',
        labWeightG: 480.0,
        sampleShrimpCount: 4,
        sampleWeightG: 160.0,
      },
    });
    const groups = await prisma.sampleGroup.findMany({ where: { batchId: BATCH } });
    assert.strictEqual(groups.length, 2);
    await assert.rejects(prisma.collectionBatch.delete({ where: { batchId: BATCH } }));
  });
});
