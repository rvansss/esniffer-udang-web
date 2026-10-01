/**
 * Integration Test: Single-Transaction Persistence, Watermark Lock, & Rollback
 * Sesuai audit Pra-Fase 3 Poin 1:
 * - Lock watermark, alokasi history_sequence, dan insert reading wajib memakai transaksi yang sama.
 * - Uji rollback serta late commit melalui jalur persistence aplikasi nyata.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma, closeDb, getCurrentWatermark, allocateHistorySequence } from '../../lib/db/client.ts';
import { PrismaTelemetryStorage } from '../../worker/storage.ts';

describe('Application Single-Transaction Persistence Tests', () => {
  const testRunId = crypto.randomUUID().slice(0, 8);
  let testChamberId: string;
  let testDeviceId: string;
  let testAssignmentId: string;
  let storage: PrismaTelemetryStorage;

  before(async () => {
    storage = new PrismaTelemetryStorage(prisma);

    const ch = await prisma.chamber.create({
      data: {
        code: `TX-CH-${testRunId}`,
        name: `Tx Chamber ${testRunId}`,
      },
    });
    testChamberId = ch.id;

    const dev = await prisma.device.create({
      data: {
        mqttDeviceId: `tx-dev-${testRunId}`,
        name: `Tx Device ${testRunId}`,
      },
    });
    testDeviceId = dev.id;

    const asg = await prisma.deviceAssignment.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberId,
        activeFrom: new Date('2026-09-01T00:00:00.000Z'),
        activeUntil: null,
      },
    });
    testAssignmentId = asg.id;
  });

  after(async () => {
    try {
      await prisma.sensorReading.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.deviceAssignment.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.deviceTimeReference.deleteMany({ where: { deviceId: testDeviceId } });
      await prisma.device.deleteMany({ where: { id: testDeviceId } });
      await prisma.chamber.deleteMany({ where: { id: testChamberId } });
    } finally {
      await closeDb();
    }
  });

  it('1. Jalur persistence aplikasi mengalokasikan sequence dan meng-insert reading dalam satu transaksi atomik', async () => {
    const watermarkBefore = await getCurrentWatermark();

    const record = {
      deviceId: testDeviceId,
      chamberId: testChamberId,
      assignmentId: testAssignmentId,
      messageId: `msg-tx-atomik-${testRunId}`,
      payloadSha256: crypto.randomBytes(32).toString('hex'),
      bootId: crypto.randomUUID(),
      sequence: 1,
      sampleUptimeMs: 10000,
      measuredAt: new Date('2026-09-05T10:00:00.000Z'),
      receivedAt: new Date(),
      measurementTimeQuality: 'SYNCED' as const,
      timeReferenceId: null,
      timeUncertaintyMs: null,
      sensors: {
        temperature_c: { value: 28.5, quality: 'OK' as const },
        humidity_percent: { value: 75.0, quality: 'OK' as const },
        mq137_raw: { value: 500, quality: 'OK' as const },
        mq136_raw: { value: null, quality: 'MISSING' as const },
        mq4_raw: { value: 300, quality: 'OK' as const },
      },
      rawPayload: { test: true },
    };

    const res = await storage.insertReading(record);
    assert.ok(res.readingId);

    const watermarkAfter = await getCurrentWatermark();
    assert.strictEqual(watermarkAfter, watermarkBefore + 1n, 'Watermark harus bertambah tepat 1');

    const saved = await prisma.sensorReading.findUnique({
      where: { id: res.readingId },
    });
    assert.ok(saved);
    assert.strictEqual(saved.historySequence, watermarkAfter, 'historySequence harus sama dengan watermark yang dialokasikan di dalam transaksi');
  });

  it('2. Rollback melalui jalur aplikasi nyata membatalkan alokasi sequence dan tidak meninggalkan data', async () => {
    const watermarkBefore = await getCurrentWatermark();

    // Data yang sengaja melanggar constraint (SYNCED tetapi measuredAt null)
    const invalidRecord = {
      deviceId: testDeviceId,
      chamberId: testChamberId,
      assignmentId: testAssignmentId,
      messageId: `msg-tx-fail-${testRunId}`,
      payloadSha256: crypto.randomBytes(32).toString('hex'),
      bootId: crypto.randomUUID(),
      sequence: 2,
      sampleUptimeMs: 10000,
      measuredAt: null, // Melanggar chk_reading_time_quality!
      receivedAt: new Date(),
      measurementTimeQuality: 'SYNCED' as const,
      timeReferenceId: null,
      timeUncertaintyMs: null,
      sensors: {
        temperature_c: { value: 28.5, quality: 'OK' as const },
        humidity_percent: { value: null, quality: 'MISSING' as const },
        mq137_raw: { value: null, quality: 'MISSING' as const },
        mq136_raw: { value: null, quality: 'MISSING' as const },
        mq4_raw: { value: null, quality: 'MISSING' as const },
      },
      rawPayload: {},
    };

    await assert.rejects(async () => {
      await storage.insertReading(invalidRecord);
    });

    // Verifikasi watermark: karena transaksi rollback, alokasi sequence juga di-rollback!
    const watermarkAfter = await getCurrentWatermark();
    assert.strictEqual(
      watermarkAfter,
      watermarkBefore,
      'Watermark tidak boleh bertambah bila transaksi penyimpanan gagal / rollback'
    );

    // Verifikasi data tidak tersimpan
    const reading = await prisma.sensorReading.findUnique({
      where: {
        deviceId_messageId: {
          deviceId: testDeviceId,
          messageId: invalidRecord.messageId,
        },
      },
    });
    assert.strictEqual(reading, null, 'Reading tidak boleh tersimpan');
  });

  it('3. Row-level lock pada alokasi sequence di dalam transaksi aplikasi mencegah commit mendahului', async () => {
    // Membuktikan bahwa transaksi A yang sedang berjalan di jalur persistence aplikasi
    // menahan transaksi B sehingga tidak ada nomor sequence yang mendahului commit
    let seqA: bigint | null = null;
    let seqB: bigint | null = null;
    let bCompletedTime = 0;
    let aCommitTime = 0;

    // Transaksi A: Jalankan transaksi aplikasi dan tahan selama 80ms
    const txAPromise = prisma.$transaction(async (tx) => {
      seqA = await allocateHistorySequence(tx);
      // Tahan transaksi
      await new Promise((resolve) => setTimeout(resolve, 80));
      aCommitTime = Date.now();
      return seqA;
    });

    // Beri jeda kecil 10ms agar Transaksi A sudah pasti mengunci baris watermark
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Transaksi B: Mencoba insert reading melalui storage
    const recordB = {
      deviceId: testDeviceId,
      chamberId: testChamberId,
      assignmentId: testAssignmentId,
      messageId: `msg-tx-b-lock-${testRunId}`,
      payloadSha256: crypto.randomBytes(32).toString('hex'),
      bootId: crypto.randomUUID(),
      sequence: 3,
      sampleUptimeMs: 20000,
      measuredAt: new Date('2026-09-05T10:05:00.000Z'),
      receivedAt: new Date(),
      measurementTimeQuality: 'SYNCED' as const,
      timeReferenceId: null,
      timeUncertaintyMs: null,
      sensors: {
        temperature_c: { value: 29.0, quality: 'OK' as const },
        humidity_percent: { value: 70.0, quality: 'OK' as const },
        mq137_raw: { value: null, quality: 'MISSING' as const },
        mq136_raw: { value: null, quality: 'MISSING' as const },
        mq4_raw: { value: null, quality: 'MISSING' as const },
      },
      rawPayload: {},
    };

    const txBPromise = (async () => {
      const res = await storage.insertReading(recordB);
      bCompletedTime = Date.now();
      const bRow = await prisma.sensorReading.findUnique({ where: { id: res.readingId } });
      seqB = bRow?.historySequence || null;
      return res;
    })();

    await Promise.all([txAPromise, txBPromise]);

    assert.ok(seqA !== null);
    assert.ok(seqB !== null);
    // Sequence B harus tepat sequence A + 1
    assert.strictEqual(seqB, seqA + 1n, 'Sequence B harus dialokasikan sesudah Sequence A');
    // Transaksi B harus selesai sesudah Transaksi A commit
    assert.ok(
      bCompletedTime >= aCommitTime,
      'Transaksi B harus tertahan dan baru selesai sesudah Transaksi A commit'
    );
  });

  it('4. Data UNKNOWN tidak mengonsumsi watermark, dan alokasi sequence baru terjadi saat promosi atomik', async () => {
    const watermarkBefore = await getCurrentWatermark();

    // 1. Simpan UNKNOWN reading
    const unknownRecord = {
      deviceId: testDeviceId,
      chamberId: null,
      assignmentId: null,
      messageId: `msg-unknown-atomic-${testRunId}`,
      payloadSha256: crypto.randomBytes(32).toString('hex'),
      bootId: crypto.randomUUID(),
      sequence: 4,
      sampleUptimeMs: 35000,
      measuredAt: null,
      receivedAt: new Date(),
      measurementTimeQuality: 'UNKNOWN' as const,
      timeReferenceId: null,
      timeUncertaintyMs: null,
      sensors: {
        temperature_c: { value: 27.0, quality: 'OK' as const },
        humidity_percent: { value: 65.0, quality: 'OK' as const },
        mq137_raw: { value: null, quality: 'MISSING' as const },
        mq136_raw: { value: null, quality: 'MISSING' as const },
        mq4_raw: { value: null, quality: 'MISSING' as const },
      },
      rawPayload: { unknown: true },
    };

    const unknownRes = await storage.insertReading(unknownRecord);
    const watermarkAfterUnknown = await getCurrentWatermark();

    // Data UNKNOWN tidak boleh mengonsumsi sequence watermark
    assert.strictEqual(
      watermarkAfterUnknown,
      watermarkBefore,
      'Data UNKNOWN tidak boleh mengalokasikan / memajukan watermark'
    );

    // 2. Buat time reference
    const timeRef = await prisma.deviceTimeReference.create({
      data: {
        deviceId: testDeviceId,
        bootId: unknownRecord.bootId,
        referenceKey: `sync-atomik-${testRunId}`,
        anchorUtc: new Date('2026-09-05T09:00:00.000Z'),
        anchorUptimeMs: 0n,
        uncertaintyMs: 100,
        source: 'status',
      },
    });

    // 3. Promosikan data UNKNOWN
    const promoRes = await storage.promoteUnknownReading(unknownRes.readingId, {
      measuredAt: new Date('2026-09-05T09:00:35.000Z'),
      chamberId: testChamberId,
      assignmentId: testAssignmentId,
      timeReferenceId: timeRef.id,
      timeUncertaintyMs: 100,
    });

    const watermarkAfterPromo = await getCurrentWatermark();
    assert.strictEqual(
      watermarkAfterPromo,
      watermarkBefore + 1n,
      'Promosi reading harus mengalokasikan tepat 1 nomor sequence baru'
    );
    assert.strictEqual(promoRes.historySequence, watermarkAfterPromo);
  });
});
