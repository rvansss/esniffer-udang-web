/**
 * Integration Test: Concurrency, Monotonic Sequence, and Snapshot Pagination
 * Menguji skenario transaksi multi-koneksi PostgreSQL nyata:
 * 1. Monotonic sequence allocation under concurrent load (row-level lock)
 * 2. Late-commit visibility & out-of-order commits (Review Note 1)
 * 3. Row lock serialization preventing sequence inversion
 * 4. Rollback safety and gap tolerance in cursor pagination
 * 5. Unresolved (UNKNOWN) reading promotion and appearance in pagination stream
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { prisma, closeDb, allocateHistorySequence, getCurrentWatermark } from '../../lib/db/client.ts';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/esniffer_dev';

describe('PostgreSQL Concurrency & Pagination Integration Tests', () => {
  const testRunId = crypto.randomUUID().slice(0, 8);
  let testChamberId: string;
  let testDeviceId: string;
  let testAssignmentId: string;

  before(async () => {
    // Setup base chamber and device
    const ch = await prisma.chamber.create({
      data: {
        code: `PAG-CH-${testRunId}`,
        name: `Pagination Test Chamber ${testRunId}`,
      },
    });
    testChamberId = ch.id;

    const dev = await prisma.device.create({
      data: {
        mqttDeviceId: `pag-dev-${testRunId}`,
        name: `Pagination Device ${testRunId}`,
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
      await prisma.sensorReading.deleteMany({
        where: { deviceId: testDeviceId },
      });
      await prisma.deviceAssignment.deleteMany({
        where: { deviceId: testDeviceId },
      });
      await prisma.deviceTimeReference.deleteMany({
        where: { deviceId: testDeviceId },
      });
      await prisma.device.deleteMany({
        where: { id: testDeviceId },
      });
      await prisma.chamber.deleteMany({
        where: { id: testChamberId },
      });
    } finally {
      await closeDb();
    }
  });

  it('1. Alokasi sequence konkuren menghasilkan urutan yang strictly unik dan monoton', async () => {
    const concurrency = 10;
    const initialWatermark = await getCurrentWatermark();

    // Jalankan 10 alokasi secara bersamaan (konkuren)
    const promises = Array.from({ length: concurrency }, () => allocateHistorySequence());
    const sequences = await Promise.all(promises);

    assert.strictEqual(sequences.length, concurrency);

    // Semua nilai harus unik
    const uniqueSeqs = new Set(sequences.map((s) => s.toString()));
    assert.strictEqual(uniqueSeqs.size, concurrency, 'Semua sequence alokasi konkuren harus unik');

    // Urutkan dan periksa kenaikan berurutan
    const sorted = [...sequences].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i] - sorted[i - 1];
      assert.strictEqual(diff, 1n, `Selisih antara sequence berurutan harus 1n, didapat: ${diff}`);
    }

    const finalWatermark = await getCurrentWatermark();
    assert.strictEqual(finalWatermark, initialWatermark + BigInt(concurrency));
  });

  it('2. Skenario Transaksi Terlambat Commit (Review Note 1) & Read Committed Visibility', async () => {
    // Menguji fenomena transaksi konkuren menggunakan 3 koneksi independen:
    // Con 1 (Tx A): Alokasi/insert sequence lebih kecil (misal 60001), belum commit
    // Con 2 (Tx B): Insert sequence lebih besar (60002), langsung commit
    // Con 3 (Reader): Baca snapshot data
    const clientA = new pg.Client({ connectionString });
    const clientB = new pg.Client({ connectionString });
    const reader = new pg.Client({ connectionString });

    await Promise.all([clientA.connect(), clientB.connect(), reader.connect()]);

    try {
      const bootId = crypto.randomUUID();
      const seqA = 60001n;
      const seqB = 60002n;

      // 1. Con 1 (Tx A) mulai transaksi dan simpan reading dengan seqA
      await clientA.query('BEGIN;');
      await clientA.query(
        `INSERT INTO sensor_readings (
          id, device_id, chamber_id, assignment_id, message_id, payload_sha256,
          boot_id, sequence, measured_at, measurement_time_quality,
          temperature_quality, temperature_c, humidity_quality, mq137_quality, mq136_quality, mq4_quality,
          raw_payload, history_sequence
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5,
          $6, 1, '2026-09-05T10:00:00Z', 'SYNCED',
          'OK', 28.0, 'MISSING', 'MISSING', 'MISSING', 'MISSING',
          '{}', $7
        );`,
        [testDeviceId, testChamberId, testAssignmentId, `msg-tx-a-${testRunId}`, crypto.randomBytes(32).toString('hex'), bootId, seqA.toString()]
      );

      // 2. Con 2 (Tx B) mulai transaksi dengan seqB dan langsung COMMIT
      await clientB.query('BEGIN;');
      await clientB.query(
        `INSERT INTO sensor_readings (
          id, device_id, chamber_id, assignment_id, message_id, payload_sha256,
          boot_id, sequence, measured_at, measurement_time_quality,
          temperature_quality, temperature_c, humidity_quality, mq137_quality, mq136_quality, mq4_quality,
          raw_payload, history_sequence
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5,
          $6, 2, '2026-09-05T10:01:00Z', 'SYNCED',
          'OK', 28.5, 'MISSING', 'MISSING', 'MISSING', 'MISSING',
          '{}', $7
        );`,
        [testDeviceId, testChamberId, testAssignmentId, `msg-tx-b-${testRunId}`, crypto.randomBytes(32).toString('hex'), bootId, seqB.toString()]
      );
      await clientB.query('COMMIT;');

      // 3. Reader membaca data saat Tx A belum commit (READ COMMITTED isolation)
      const page1Res = await reader.query(
        `SELECT history_sequence, message_id FROM sensor_readings
         WHERE chamber_id = $1 AND history_sequence IS NOT NULL
         ORDER BY history_sequence ASC;`,
        [testChamberId]
      );

      const returnedSeqsBefore = page1Res.rows.map((r) => BigInt(r.history_sequence));
      // Verifikasi: Tx B (seqB) sudah terbaca
      assert.ok(returnedSeqsBefore.includes(seqB), 'Reading Tx B (committed) harus terlihat');
      // Verifikasi: Tx A (seqA) BELUM terlihat karena belum commit
      assert.ok(!returnedSeqsBefore.includes(seqA), 'Reading Tx A (uncommitted) tidak boleh terlihat (Read Committed)');

      // 4. Con 1 (Tx A) sekarang COMMIT
      await clientA.query('COMMIT;');

      // 5. Reader membaca lagi: sekarang Tx A (seqA) muncul di belakang Tx B
      const page2Res = await reader.query(
        `SELECT history_sequence, message_id FROM sensor_readings
         WHERE chamber_id = $1 AND history_sequence IS NOT NULL
         ORDER BY history_sequence ASC;`,
        [testChamberId]
      );
      const returnedSeqsAfter = page2Res.rows.map((r) => BigInt(r.history_sequence));
      assert.ok(returnedSeqsAfter.includes(seqA), 'Reading Tx A sekarang harus terlihat sesudah commit');
      assert.ok(returnedSeqsAfter.includes(seqB), 'Reading Tx B tetap terlihat');

      // Ini membuktikan kebenaran Review Note 1:
      // PostgreSQL sequence / manual sequence tidak menjamin urutan commit.
      // Jika client hanya mengandalkan cursor `> watermark` (di mana watermark = 60002),
      // maka seqA (60001) yang terlambat commit akan terlewatkan jika tanpa mekanisme penanganan terlambat commit!
    } finally {
      await Promise.all([clientA.end(), clientB.end(), reader.end()]);
    }
  });

  it('3. Row-level lock pada allocateHistorySequence mencegah alokasi sequence mendahului commit', async () => {
    // Skenario: Membuktikan bahwa dengan allocateHistorySequence di dalam transaksi,
    // Tx B diblokir dan tidak bisa mengambil sequence berikutnya sampai Tx A commit / rollback.
    const clientA = new pg.Client({ connectionString });
    const clientB = new pg.Client({ connectionString });

    await Promise.all([clientA.connect(), clientB.connect()]);

    try {
      await clientA.query('BEGIN;');
      // Tx A mengambil sequence di dalam transaksinya
      const resA = await clientA.query(
        `UPDATE history_sequence_watermark
         SET current_sequence = current_sequence + 1
         WHERE id = 1
         RETURNING current_sequence;`
      );
      const seqA = BigInt(resA.rows[0].current_sequence);

      let bAcquired = false;
      let seqB: bigint | null = null;

      // Tx B mencoba mengambil sequence di transaksi lain secara konkuren
      const bPromise = (async () => {
        await clientB.query('BEGIN;');
        const resB = await clientB.query(
          `UPDATE history_sequence_watermark
           SET current_sequence = current_sequence + 1
           WHERE id = 1
           RETURNING current_sequence;`
        );
        bAcquired = true;
        seqB = BigInt(resB.rows[0].current_sequence);
        await clientB.query('COMMIT;');
      })();

      // Beri sedikit jeda (50ms) untuk memastikan Tx B sudah mencoba mengeksekusi query dan terblokir
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verifikasi: Tx B masih TERBLOKIR karena row-lock pada id=1 ditahan oleh Tx A
      assert.strictEqual(bAcquired, false, 'Tx B harus terblokir menunggu row-lock dari Tx A');

      // Sekarang Tx A COMMIT
      await clientA.query('COMMIT;');

      // Tunggu Tx B selesai
      await bPromise;

      assert.strictEqual(bAcquired, true, 'Tx B selesai sesudah Tx A commit');
      assert.strictEqual(seqB, seqA + 1n, 'Sequence Tx B harus tepat seqA + 1');
    } finally {
      await Promise.all([clientA.end(), clientB.end()]);
    }
  });

  it('4. Rollback / alokasi terbuang menghasilkan celah sequence tanpa merusak pembacaan cursor pagination', async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();

    try {
      const bootId = crypto.randomUUID();

      // Tx A: Alokasi sequence seqA (misal worker mati sebelum insert selesai atau insert gagal)
      const seqA = await allocateHistorySequence();

      // Tx B: Alokasi sequence seqB (seqA + 1), insert reading berhasil, dan COMMIT
      const seqB = await allocateHistorySequence();
      assert.strictEqual(seqB, seqA + 1n, 'seqB harus tepat seqA + 1');

      await client.query(
        `INSERT INTO sensor_readings (
          id, device_id, chamber_id, assignment_id, message_id, payload_sha256,
          boot_id, sequence, measured_at, measurement_time_quality,
          temperature_quality, temperature_c, humidity_quality, mq137_quality, mq136_quality, mq4_quality,
          raw_payload, history_sequence
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5,
          $6, 1, '2026-09-05T10:10:00Z', 'SYNCED',
          'OK', 27.5, 'MISSING', 'MISSING', 'MISSING', 'MISSING',
          '{}', $7
        );`,
        [testDeviceId, testChamberId, testAssignmentId, `msg-rollback-${testRunId}`, crypto.randomBytes(32).toString('hex'), bootId, seqB.toString()]
      );

      // Ada gap: seqA tidak ada di sensor_readings (alokasi terbuang/gagal insert), seqB ter-commit
      // Verifikasi pembacaan cursor pagination (WHERE history_sequence >= seqA AND device_id = testDeviceId)
      const pageRes = await client.query(
        `SELECT history_sequence, message_id FROM sensor_readings
         WHERE history_sequence >= $1 AND device_id = $2
         ORDER BY history_sequence ASC;`,
        [seqA.toString(), testDeviceId]
      );

      // Verifikasi celah (gap): seqA tidak ada dalam hasil query
      const foundSeqA = pageRes.rows.some((r) => BigInt(r.history_sequence) === seqA);
      assert.strictEqual(foundSeqA, false, 'seqA tidak boleh ada karena alokasi terbuang');

      // Elemen pertama yang dikembalikan harus seqB (elemen sesudah celah)
      assert.strictEqual(BigInt(pageRes.rows[0].history_sequence), seqB);
    } finally {
      await client.end();
    }
  });

  it('5. Promosi reading UNKNOWN menjadi RECONSTRUCTED mengalokasikan sequence baru dan muncul di stream pagination', async () => {
    const bootId = crypto.randomUUID();
    const messageId = `msg-promo-${testRunId}`;

    // 1. Simpan reading berstatus UNKNOWN (history_sequence = null, chamber_id = null, assignment_id = null)
    const unknownReading = await prisma.sensorReading.create({
      data: {
        deviceId: testDeviceId,
        messageId,
        payloadSha256: crypto.randomBytes(32).toString('hex'),
        bootId,
        sequence: 100n,
        sampleUptimeMs: 30000n,
        measuredAt: null,
        historySequence: null,
        measurementTimeQuality: 'UNKNOWN',
        temperatureQuality: 'OK',
        temperatureC: 26.8,
        humidityQuality: 'MISSING',
        mq137Quality: 'MISSING',
        mq136Quality: 'MISSING',
        mq4Quality: 'MISSING',
        rawPayload: { uptime: 30000 },
      },
    });

    // 2. Query pagination chamber: reading ini TIDAK ADA
    const chamberReadingsBefore = await prisma.sensorReading.findMany({
      where: { chamberId: testChamberId },
    });
    assert.strictEqual(chamberReadingsBefore.some((r) => r.id === unknownReading.id), false);

    // 3. Status sync tiba: buat time reference
    const timeRef = await prisma.deviceTimeReference.create({
      data: {
        deviceId: testDeviceId,
        bootId,
        referenceKey: `sync-${testRunId}`,
        anchorUtc: new Date('2026-09-05T09:00:00.000Z'),
        anchorUptimeMs: 0n,
        uncertaintyMs: 150,
        source: 'status',
      },
    });

    // 4. Promosi reading: hitung measured_at dan alokasikan sequence baru di dalam transaksi
    const promoSequence = await allocateHistorySequence();
    const calculatedMeasuredAt = new Date('2026-09-05T09:00:30.000Z'); // anchor + 30s

    await prisma.sensorReading.update({
      where: { id: unknownReading.id },
      data: {
        measurementTimeQuality: 'RECONSTRUCTED',
        measuredAt: calculatedMeasuredAt,
        chamberId: testChamberId,
        assignmentId: testAssignmentId,
        timeReferenceId: timeRef.id,
        timeUncertaintyMs: 150,
        historySequence: promoSequence,
      },
    });

    // 5. Query pagination chamber sekarang: reading MUNCUL dengan sequence promoSequence
    const chamberReadingsAfter = await prisma.sensorReading.findMany({
      where: {
        chamberId: testChamberId,
        historySequence: promoSequence,
      },
    });

    assert.strictEqual(chamberReadingsAfter.length, 1);
    assert.strictEqual(chamberReadingsAfter[0].id, unknownReading.id);
    assert.strictEqual(chamberReadingsAfter[0].measurementTimeQuality, 'RECONSTRUCTED');
    assert.strictEqual(chamberReadingsAfter[0].historySequence, promoSequence);
  });
});
