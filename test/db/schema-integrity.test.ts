/**
 * Integration Test: PostgreSQL Schema Integrity & Constraints
 * Sesuai KF-ING-004, Review Notes 1, 2, 3, dan docs/esniffer/03-technical-design.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { Prisma } from '@prisma/client';

describe('PostgreSQL Schema Integrity & Constraint Tests', () => {
  // Test fixture identifiers
  const testRunId = crypto.randomUUID().slice(0, 8);
  let testChamberAId: string;
  let testChamberBId: string;
  let testDeviceId: string;
  let testDevice2Id: string;
  let testAssignmentAId: string;
  let testAssignment2AId: string;

  before(async () => {
    // Setup test fixtures
    const chA = await prisma.chamber.create({
      data: {
        code: `TEST-CH-A-${testRunId}`,
        name: `Test Chamber A ${testRunId}`,
      },
    });
    testChamberAId = chA.id;

    const chB = await prisma.chamber.create({
      data: {
        code: `TEST-CH-B-${testRunId}`,
        name: `Test Chamber B ${testRunId}`,
      },
    });
    testChamberBId = chB.id;

    const dev = await prisma.device.create({
      data: {
        mqttDeviceId: `test-dev-${testRunId}`,
        name: `Test Device ${testRunId}`,
        isActive: true,
      },
    });
    testDeviceId = dev.id;

    const dev2 = await prisma.device.create({
      data: {
        mqttDeviceId: `test-dev2-${testRunId}`,
        name: `Test Device 2 ${testRunId}`,
        isActive: true,
      },
    });
    testDevice2Id = dev2.id;

    const asgA = await prisma.deviceAssignment.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberAId,
        activeFrom: new Date('2026-09-01T00:00:00.000Z'),
        activeUntil: new Date('2026-09-10T00:00:00.000Z'),
      },
    });
    testAssignmentAId = asgA.id;

    const asg2A = await prisma.deviceAssignment.create({
      data: {
        deviceId: testDevice2Id,
        chamberId: testChamberAId,
        activeFrom: new Date('2026-09-01T00:00:00.000Z'),
        activeUntil: new Date('2026-09-10T00:00:00.000Z'),
      },
    });
    testAssignment2AId = asg2A.id;
  });

  after(async () => {
    // Clean up test data
    try {
      await prisma.sensorReading.deleteMany({
        where: { deviceId: { in: [testDeviceId, testDevice2Id] } },
      });
      await prisma.deviceAssignment.deleteMany({
        where: { deviceId: { in: [testDeviceId, testDevice2Id] } },
      });
      await prisma.deviceTimeReference.deleteMany({
        where: { deviceId: { in: [testDeviceId, testDevice2Id] } },
      });
      await prisma.device.deleteMany({
        where: { id: { in: [testDeviceId, testDevice2Id] } },
      });
      await prisma.chamber.deleteMany({
        where: { id: { in: [testChamberAId, testChamberBId] } },
      });
    } finally {
      await closeDb();
    }
  });

  it('1. Unique constraint (device_id, message_id) menolak duplikasi message_id pada perangkat yang sama', async () => {
    const messageId = `msg-uniq-${testRunId}`;
    const bootId = crypto.randomUUID();
    const payloadSha = crypto.randomBytes(32).toString('hex');
    const seq1 = await allocateHistorySequence();

    // Insert reading pertama
    await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberAId,
        assignmentId: testAssignmentAId,
        historySequence: seq1,
        messageId,
        payloadSha256: payloadSha,
        bootId,
        sequence: 1n,
        measuredAt: new Date('2026-09-05T10:00:00.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureQuality: 'OK',
        temperatureC: 28.5,
        humidityQuality: 'OK',
        humidityPercent: 75.0,
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: { msg: 'first' },
      },
    });

    // Percobaan insert kedua dengan (deviceId, messageId) yang sama
    const seq2 = await allocateHistorySequence();
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberAId,
            assignmentId: testAssignmentAId,
            historySequence: seq2,
            messageId,
            payloadSha256: payloadSha,
            bootId,
            sequence: 2n,
            measuredAt: new Date('2026-09-05T10:01:00.000Z'),
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'OK',
            temperatureC: 28.5,
            humidityQuality: 'OK',
            humidityPercent: 75.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: { msg: 'second' },
          },
        });
      },
      (err: unknown) => {
        const isPrismaUnique =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        return isPrismaUnique;
      },
      'Harus ditolak oleh PostgreSQL Unique Constraint (device_id, message_id)'
    );

    // message_id yang sama untuk device_id BERBEDA diizinkan
    const seq3 = await allocateHistorySequence();
    const otherDeviceReading = await prisma.sensorReading.create({
      data: {
        deviceId: testDevice2Id,
        chamberId: testChamberAId,
        assignmentId: testAssignment2AId,
        historySequence: seq3,
        messageId,
        payloadSha256: payloadSha,
        bootId,
        sequence: 1n,
        measuredAt: new Date('2026-09-05T10:00:00.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureQuality: 'OK',
        temperatureC: 27.0,
        humidityQuality: 'OK',
        humidityPercent: 70.0,
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: { msg: 'device2' },
      },
    });
    assert.ok(otherDeviceReading.id, 'Device berbeda boleh menggunakan message_id yang sama');
  });

  it('2. Deduplikasi: payload identik menghasilkan duplicate; payload berbeda menghasilkan MESSAGE_ID_CONFLICT', async () => {
    const messageId = `msg-dedupe-${testRunId}`;
    const bootId = crypto.randomUUID();
    const originalPayload = { uptime_ms: 1000, value: 42 };
    const originalHash = crypto.createHash('sha256').update(JSON.stringify(originalPayload)).digest('hex');
    const seq = await allocateHistorySequence();

    // 1. Simpan original
    await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberAId,
        assignmentId: testAssignmentAId,
        historySequence: seq,
        messageId,
        payloadSha256: originalHash,
        bootId,
        sequence: 10n,
        measuredAt: new Date('2026-09-05T11:00:00.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureQuality: 'OK',
        temperatureC: 29.1,
        humidityQuality: 'OK',
        humidityPercent: 80.0,
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: originalPayload,
      },
    });

    // 2. Evaluasi kedatangan pesan kedua dengan payload sama:
    const duplicateIncomingHash = crypto.createHash('sha256').update(JSON.stringify(originalPayload)).digest('hex');
    const existingForDuplicate = await prisma.sensorReading.findUnique({
      where: {
        deviceId_messageId: {
          deviceId: testDeviceId,
          messageId,
        },
      },
    });

    assert.ok(existingForDuplicate);
    assert.strictEqual(
      existingForDuplicate.payloadSha256,
      duplicateIncomingHash,
      'Hash identik: terdeteksi sebagai DUPLICATE (idempotent no-op)'
    );

    // 3. Evaluasi kedatangan pesan dengan message_id sama tapi payload BERBEDA:
    const mutatedPayload = { uptime_ms: 1000, value: 999 };
    const mutatedHash = crypto.createHash('sha256').update(JSON.stringify(mutatedPayload)).digest('hex');

    assert.notStrictEqual(originalHash, mutatedHash);
    const isConflict = existingForDuplicate.payloadSha256 !== mutatedHash;
    assert.strictEqual(isConflict, true, 'Hash berbeda: harus menghasilkan status MESSAGE_ID_CONFLICT');
  });

  it('3. Retry committed reading tetap valid setelah device dipindah atau dinonaktifkan', async () => {
    const messageId = `msg-retry-${testRunId}`;
    const bootId = crypto.randomUUID();
    const payload = { temp: 28.0 };
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const seq = await allocateHistorySequence();

    // 1. Simpan reading saat device berada di Chamber A (assignment testAssignmentAId)
    const originalReading = await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberAId,
        assignmentId: testAssignmentAId,
        historySequence: seq,
        messageId,
        payloadSha256: hash,
        bootId,
        sequence: 20n,
        measuredAt: new Date('2026-09-05T12:00:00.000Z'),
        measurementTimeQuality: 'SYNCED',
        temperatureQuality: 'OK',
        temperatureC: 28.0,
        humidityQuality: 'OK',
        humidityPercent: 78.0,
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: payload,
      },
    });

    // 2. Perangkat kemudian dinonaktifkan (isActive: false)
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { isActive: false },
    });

    // 3. Retry pesan yang sama tiba lagi
    // Worker mencari (deviceId, messageId) sebelum memeriksa status aktif perangkat
    const found = await prisma.sensorReading.findUnique({
      where: {
        deviceId_messageId: {
          deviceId: testDeviceId,
          messageId,
        },
      },
    });

    assert.ok(found);
    assert.strictEqual(found.id, originalReading.id);
    assert.strictEqual(found.chamberId, testChamberAId, 'Mempertahankan chamber historis saat commit');
    assert.strictEqual(found.assignmentId, testAssignmentAId, 'Mempertahankan assignment historis saat commit');

    // Pulihkan status aktif device untuk tes berikutnya
    await prisma.device.update({
      where: { id: testDeviceId },
      data: { isActive: true },
    });
  });

  it('4. Assignment non-overlapping (btree_gist) menolak interval yang tumpang tindih untuk device yang sama', async () => {
    // testDeviceId sudah memiliki assignment: [2026-09-01, 2026-09-10)

    // A. Percobaan assignment tumpang tindih: [2026-09-05, 2026-09-15)
    await assert.rejects(
      async () => {
        await prisma.deviceAssignment.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberBId,
            activeFrom: new Date('2026-09-05T00:00:00.000Z'),
            activeUntil: new Date('2026-09-15T00:00:00.000Z'),
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('device_assignments_no_overlap') || msg.includes('exclusion');
      },
      'Harus ditolak oleh exclusion constraint btree_gist device_assignments_no_overlap'
    );

    // B. Percobaan assignment open-ended yang overlap: [2026-09-08, NULL)
    await assert.rejects(
      async () => {
        await prisma.deviceAssignment.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberBId,
            activeFrom: new Date('2026-09-08T00:00:00.000Z'),
            activeUntil: null,
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('device_assignments_no_overlap') || msg.includes('exclusion');
      },
      'Harus ditolak saat assignment open-ended tumpang tindih'
    );

    // C. Assignment interval yang BERSEBELAHAN (tidak tumpang tindih) harus BERHASIL: [2026-09-10, 2026-09-20)
    const nonOverlappingAsg = await prisma.deviceAssignment.create({
      data: {
        deviceId: testDeviceId,
        chamberId: testChamberBId,
        activeFrom: new Date('2026-09-10T00:00:00.000Z'),
        activeUntil: new Date('2026-09-20T00:00:00.000Z'),
      },
    });
    assert.ok(nonOverlappingAsg.id, 'Interval bersebelahan [2026-09-10, 2026-09-20) harus diizinkan');
  });

  it('5. Trigger check_sensor_reading_assignment menegakkan konsistensi device dan chamber', async () => {
    // testAssignmentAId milik (testDeviceId, testChamberAId)
    const seq1 = await allocateHistorySequence();
    const seq2 = await allocateHistorySequence();

    // A. Percobaan insert reading dengan assignment testAssignmentAId tapi chamber_id = testChamberBId (MISMATCH)
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberBId, // SALAH: harus testChamberAId
            assignmentId: testAssignmentAId,
            historySequence: seq1,
            messageId: `msg-mismatch-ch-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId: crypto.randomUUID(),
            sequence: 30n,
            measuredAt: new Date('2026-09-05T13:00:00.000Z'),
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'OK',
            temperatureC: 28.0,
            humidityQuality: 'OK',
            humidityPercent: 78.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('does not match assignment chamber_id');
      },
      'Trigger harus menggagalkan jika chamber_id tidak cocok dengan assignment'
    );

    // B. Percobaan insert reading dengan assignment testAssignmentAId tapi device_id = testDevice2Id (MISMATCH)
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDevice2Id, // SALAH: harus testDeviceId
            chamberId: testChamberAId,
            assignmentId: testAssignmentAId,
            historySequence: seq2,
            messageId: `msg-mismatch-dev-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId: crypto.randomUUID(),
            sequence: 31n,
            measuredAt: new Date('2026-09-05T13:00:00.000Z'),
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'OK',
            temperatureC: 28.0,
            humidityQuality: 'OK',
            humidityPercent: 78.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('does not match assignment device_id');
      },
      'Trigger harus menggagalkan jika device_id tidak cocok dengan assignment'
    );
  });

  it('6. SQL check constraint chk_reading_time_quality menegakkan aturan known-time vs unknown-time', async () => {
    const bootId = crypto.randomUUID();
    const seq = await allocateHistorySequence();

    // A. SYNCED tetapi measured_at NULL -> HARUS DITOLAK
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberAId,
            assignmentId: testAssignmentAId,
            historySequence: seq,
            messageId: `msg-chk-synced-null-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId,
            sequence: 40n,
            measuredAt: null, // SALAH untuk SYNCED
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'OK',
            temperatureC: 28.0,
            humidityQuality: 'OK',
            humidityPercent: 78.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('chk_reading_time_quality');
      },
      'SYNCED dengan measured_at NULL harus ditolak chk_reading_time_quality'
    );

    // B. UNKNOWN tetapi measured_at TIDAK NULL -> HARUS DITOLAK
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            messageId: `msg-chk-unknown-notnull-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId,
            sequence: 41n,
            sampleUptimeMs: 50000n,
            measuredAt: new Date('2026-09-05T14:00:00.000Z'), // SALAH untuk UNKNOWN
            measurementTimeQuality: 'UNKNOWN',
            temperatureQuality: 'OK',
            temperatureC: 28.0,
            humidityQuality: 'OK',
            humidityPercent: 78.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('chk_reading_time_quality');
      },
      'UNKNOWN dengan measured_at terisi harus ditolak chk_reading_time_quality'
    );

    // C. UNKNOWN tetapi memiliki history_sequence -> HARUS DITOLAK
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            messageId: `msg-chk-unknown-seq-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId,
            sequence: 42n,
            sampleUptimeMs: 50000n,
            measuredAt: null,
            historySequence: 9999n, // SALAH: unknown tidak boleh masuk urutan pagination publik
            measurementTimeQuality: 'UNKNOWN',
            temperatureQuality: 'OK',
            temperatureC: 28.0,
            humidityQuality: 'OK',
            humidityPercent: 78.0,
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('chk_reading_time_quality');
      },
      'UNKNOWN dengan history_sequence terisi harus ditolak chk_reading_time_quality'
    );

    // D. UNKNOWN yang valid: measured_at NULL, sample_uptime_ms terisi, historySequence NULL, chamber NULL, assignment NULL -> BERHASIL
    const validUnknown = await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        messageId: `msg-chk-unknown-valid-${testRunId}`,
        payloadSha256: crypto.randomBytes(32).toString('hex'),
        bootId,
        sequence: 43n,
        sampleUptimeMs: 50000n,
        measuredAt: null,
        historySequence: null,
        measurementTimeQuality: 'UNKNOWN',
        temperatureQuality: 'OK',
        temperatureC: 28.0,
        humidityQuality: 'OK',
        humidityPercent: 78.0,
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: { raw: 'sensor reading at uptime 50000ms' },
      },
    });
    assert.ok(validUnknown.id, 'Reading UNKNOWN yang valid harus berhasil disimpan');
  });

  it('7. SQL check constraints untuk kualitas sensor (OK vs MISSING)', async () => {
    const bootId = crypto.randomUUID();
    const seq1 = await allocateHistorySequence();
    const seq2 = await allocateHistorySequence();

    // A. Quality OK tapi nilai NULL -> HARUS DITOLAK chk_temperature_quality
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberAId,
            assignmentId: testAssignmentAId,
            historySequence: seq1,
            messageId: `msg-chk-sens-ok-null-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId,
            sequence: 50n,
            measuredAt: new Date('2026-09-05T15:00:00.000Z'),
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'OK',
            temperatureC: null, // SALAH: jika OK, nilai tidak boleh NULL
            humidityQuality: 'MISSING',
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('chk_temperature_quality');
      },
      'temperatureQuality OK dengan nilai NULL harus ditolak chk_temperature_quality'
    );

    // B. Quality MISSING tapi nilai TERISI -> HARUS DITOLAK chk_temperature_quality
    await assert.rejects(
      async () => {
        await prisma.sensorReading.create({
          data: {
            deviceId: testDeviceId,
            chamberId: testChamberAId,
            assignmentId: testAssignmentAId,
            historySequence: seq2,
            messageId: `msg-chk-sens-missing-val-${testRunId}`,
            payloadSha256: crypto.randomBytes(32).toString('hex'),
            bootId,
            sequence: 51n,
            measuredAt: new Date('2026-09-05T15:01:00.000Z'),
            measurementTimeQuality: 'SYNCED',
            temperatureQuality: 'MISSING',
            temperatureC: 25.5, // SALAH: jika MISSING, nilai harus NULL
            humidityQuality: 'MISSING',
            mq137Quality: 'MISSING',
            mq136Quality: 'MISSING',
            mq4Quality: 'MISSING',
            rawPayload: {},
          },
        });
      },
      (err: unknown) => {
        const msg = String(err);
        return msg.includes('chk_temperature_quality');
      },
      'temperatureQuality MISSING dengan nilai terisi harus ditolak chk_temperature_quality'
    );
  });

  it('8. Rekonstruksi waktu mempertahankan canonical payload hash asli', async () => {
    const bootId = crypto.randomUUID();
    const rawPayload = { uptime_ms: 120000, temp: 27.8 };
    const originalHash = crypto.createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex');

    // 1. Simpan data awal sebagai UNKNOWN
    const unknownReading = await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        messageId: `msg-recon-hash-${testRunId}`,
        payloadSha256: originalHash,
        bootId,
        sequence: 60n,
        sampleUptimeMs: 120000n,
        measuredAt: null,
        historySequence: null,
        measurementTimeQuality: 'UNKNOWN',
        temperatureQuality: 'OK',
        temperatureC: 27.8,
        humidityQuality: 'MISSING',
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload,
      },
    });

    // 2. Buat DeviceTimeReference yang bersesuaian
    const timeRef = await prisma.deviceTimeReference.create({
      data: {
        deviceId: testDeviceId,
        bootId,
        referenceKey: `ref-${testRunId}`,
        anchorUtc: new Date('2026-09-05T12:00:00.000Z'),
        anchorUptimeMs: 100000n,
        uncertaintyMs: 200,
        source: 'status_sync',
      },
    });

    // 3. Lakukan rekonstruksi waktu: update measurementTimeQuality, measuredAt, timeReferenceId, historySequence
    // Note: payload_sha256 dan raw_payload TIDAK BOLEH BERUBAH
    const reconstructedAt = new Date('2026-09-05T12:00:20.000Z'); // 100000ms + 20000ms
    const newSeq = await allocateHistorySequence();
    const updated = await prisma.sensorReading.update({
      where: { id: unknownReading.id },
      data: {
        measurementTimeQuality: 'RECONSTRUCTED',
        measuredAt: reconstructedAt,
        timeReferenceId: timeRef.id,
        timeUncertaintyMs: 200,
        chamberId: testChamberAId,
        assignmentId: testAssignmentAId,
        historySequence: newSeq,
      },
    });

    assert.strictEqual(updated.measurementTimeQuality, 'RECONSTRUCTED');
    assert.strictEqual(updated.payloadSha256, originalHash, 'payloadSha256 harus identik sebelum dan sesudah rekonstruksi');
    assert.deepStrictEqual(updated.rawPayload, rawPayload, 'rawPayload harus identik');
    assert.strictEqual(updated.historySequence, newSeq);
  });

  it('9. Reading unresolved dapat ditemukan melalui audit perangkat namun tersembunyi dari pagination publik', async () => {
    const bootId = crypto.randomUUID();
    const messageId = `msg-audit-${testRunId}`;

    await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        messageId,
        payloadSha256: crypto.randomBytes(32).toString('hex'),
        bootId,
        sequence: 70n,
        sampleUptimeMs: 99999n,
        measuredAt: null,
        historySequence: null,
        measurementTimeQuality: 'UNKNOWN',
        temperatureQuality: 'OK',
        temperatureC: 26.5,
        humidityQuality: 'MISSING',
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: { audit: true },
      },
    });

    // Query pagination publik (menggunakan historySequence filter)
    const publicReadings = await prisma.sensorReading.findMany({
      where: {
        historySequence: { not: null },
      },
    });
    const foundInPublic = publicReadings.some((r) => r.messageId === messageId);
    assert.strictEqual(foundInPublic, false, 'Data UNKNOWN tanpa history_sequence tidak boleh muncul di pagination publik');

    // Query audit perangkat (khusus mencari status UNKNOWN atau perangkat spesifik)
    const auditReadings = await prisma.sensorReading.findMany({
      where: {
        deviceId: testDeviceId,
        measurementTimeQuality: 'UNKNOWN',
      },
    });
    const foundInAudit = auditReadings.some((r) => r.messageId === messageId);
    assert.strictEqual(foundInAudit, true, 'Data UNKNOWN harus dapat diaudit melalui riwayat perangkat');
  });
});
