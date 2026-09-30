/**
 * Pengujian unit snapshot pagination, keyset cursor, dan penanganan late-committing sequence
 * Sesuai Review Note 1, KF-HIS-001, dan docs/esniffer/03-technical-design.md Section 5.5 & 7.5
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCursor,
  decodeCursor,
  computeFilterHash,
  isReadingInSnapshot,
  isCandidateAfterCursor,
  calculateSafeWatermark,
  PaginationCursorError,
  type CursorPayload,
  type PaginationFilter,
  type SortTuple,
} from '../shared/pagination.ts';

const testFilter: PaginationFilter = {
  chamberId: 'chamber-uuid-1',
  deviceId: 'esp32-001',
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-07T00:00:00.000Z',
  order: 'DESC',
};

const secretKey = 'test-signing-secret';

test('Snapshot Pagination: Encode dan decode cursor valid', () => {
  const payload: CursorPayload = {
    v: 1,
    fh: computeFilterHash(testFilter),
    wm: '500',
    ma: '2026-09-05T12:00:00.000Z',
    ra: '2026-09-05T12:00:01.000Z',
    hs: '450',
  };

  const cursorStr = encodeCursor(payload, secretKey);
  assert.ok(cursorStr.includes('.'));

  const decoded = decodeCursor(cursorStr, testFilter, secretKey);
  assert.strictEqual(decoded.v, 1);
  assert.strictEqual(decoded.wm, '500');
  assert.strictEqual(decoded.hs, '450');
  assert.strictEqual(decoded.ma, '2026-09-05T12:00:00.000Z');
});

test('Snapshot Pagination: Menolak cursor yang dimanipulasi (tampered) atau tanda tangan salah', () => {
  const payload: CursorPayload = {
    v: 1,
    fh: computeFilterHash(testFilter),
    wm: '500',
    ma: '2026-09-05T12:00:00.000Z',
    ra: '2026-09-05T12:00:01.000Z',
    hs: '450',
  };

  const cursorStr = encodeCursor(payload, secretKey);
  const tampered = cursorStr.slice(0, -4) + 'abcd';

  assert.throws(
    () => decodeCursor(tampered, testFilter, secretKey),
    (err: Error) =>
      err instanceof PaginationCursorError &&
      err.message.includes('signature mismatch')
  );
});

test('Snapshot Pagination: Menolak cursor jika parameter filter diubah di tengah traversal', () => {
  const payload: CursorPayload = {
    v: 1,
    fh: computeFilterHash(testFilter),
    wm: '500',
    ma: '2026-09-05T12:00:00.000Z',
    ra: '2026-09-05T12:00:01.000Z',
    hs: '450',
  };

  const cursorStr = encodeCursor(payload, secretKey);

  // Klien mencoba menggunakan cursor yang sama pada chamber berbeda
  const changedFilter: PaginationFilter = {
    ...testFilter,
    chamberId: 'chamber-uuid-OTHER',
  };

  assert.throws(
    () => decodeCursor(cursorStr, changedFilter, secretKey),
    (err: Error) =>
      err instanceof PaginationCursorError &&
      err.message.includes('filter mismatch')
  );
});

test('Review Note 1: Mekanisme snapshot pagination mengisolasi transaksi late-commit di atas watermark', () => {
  const watermark = 500n;

  // Transaksi yang masuk/commit sebelum atau setara watermark masuk ke snapshot
  assert.strictEqual(isReadingInSnapshot(499n, watermark), true);
  assert.strictEqual(isReadingInSnapshot(500n, watermark), true);

  // Telemetry baru, backlog yang baru masuk, atau rekonsiliasi yang selesai setelah
  // watermark dibekukan akan mendapat sequence > 500 dan diabaikan dari traversal ini
  assert.strictEqual(isReadingInSnapshot(501n, watermark), false);
  assert.strictEqual(isReadingInSnapshot(1000n, watermark), false);
});

test('Review Note 1: Skenario anomali late-commit (Tx A seq lebih kecil, Tx B commit, watermark dibaca, Tx A commit)', () => {
  // Skenario konkurensi:
  // t1: Transaksi A mengalokasikan sequence 100 via nextval() (belum commit)
  const seqTxA = 100n;
  // t2: Transaksi B mengalokasikan sequence 101 via nextval()
  const seqTxB = 101n;
  // t3: Transaksi B commit terlebih dahulu
  const maxCommittedSeq: bigint = seqTxB; // 101n
  const minInFlightSeq: bigint = seqTxA;   // 100n (A masih aktif berjalan)

  // t4: Klien membaca Halaman 1.
  // Bila menggunakan NAIVE watermark max(history_sequence):
  const naiveWatermark = maxCommittedSeq; // 101n

  // Pembuktian kegagalan Naive Watermark:
  // Karena 100n <= 101n, record A secara keliru lolos ke snapshot traversal lama
  // padahal saat t4 snapshot dibuat, A belum committed!
  assert.strictEqual(isReadingInSnapshot(seqTxA, naiveWatermark), true);

  // Solusi: Safe Watermark Calculation (memperhitungkan in-flight transactions):
  // Saat t4, safe watermark dihitung dengan memperhatikan bahwa ada Tx A (100n) yang sedang in-flight
  const safeWatermark = calculateSafeWatermark(maxCommittedSeq, minInFlightSeq);
  assert.strictEqual(safeWatermark, 99n);

  // Dengan Safe Watermark (99n):
  // Baik Tx A (100n) maupun Tx B (101n) dievaluasi di luar snapshot yang sedang berjalan
  assert.strictEqual(isReadingInSnapshot(seqTxA, safeWatermark!), false);
  assert.strictEqual(isReadingInSnapshot(seqTxB, safeWatermark!), false);

  // CATATAN: Ini adalah pemodelan logika aplikasi Fase 1.
  // Jaminan transaksi fisik di PostgreSQL nyata wajib diuji pada Fase 2 (T-HIS-04).
});

test('Snapshot Pagination: Total order keyset (measuredAt DESC, receivedAt DESC, historySequence DESC)', () => {
  const cursorTuple: SortTuple = {
    measuredAt: new Date('2026-09-05T10:00:00.000Z'),
    receivedAt: new Date('2026-09-05T10:00:02.000Z'),
    historySequence: 300n,
  };

  // 1. Candidate dengan measuredAt lebih tua -> berada SESUDAH cursor (true)
  assert.strictEqual(
    isCandidateAfterCursor(
      {
        measuredAt: new Date('2026-09-05T09:59:59.000Z'),
        receivedAt: new Date('2026-09-05T10:00:02.000Z'),
        historySequence: 299n,
      },
      cursorTuple
    ),
    true
  );

  // 2. Candidate dengan measuredAt lebih baru -> berada SEBELUM cursor (false)
  assert.strictEqual(
    isCandidateAfterCursor(
      {
        measuredAt: new Date('2026-09-05T10:00:01.000Z'),
        receivedAt: new Date('2026-09-05T10:00:02.000Z'),
        historySequence: 301n,
      },
      cursorTuple
    ),
    false
  );

  // 3. measuredAt sama, receivedAt lebih tua -> SESUDAH cursor (true)
  assert.strictEqual(
    isCandidateAfterCursor(
      {
        measuredAt: new Date('2026-09-05T10:00:00.000Z'),
        receivedAt: new Date('2026-09-05T10:00:01.000Z'),
        historySequence: 300n,
      },
      cursorTuple
    ),
    true
  );

  // 4. measuredAt sama, receivedAt sama, historySequence lebih kecil -> SESUDAH cursor (true)
  assert.strictEqual(
    isCandidateAfterCursor(
      {
        measuredAt: new Date('2026-09-05T10:00:00.000Z'),
        receivedAt: new Date('2026-09-05T10:00:02.000Z'),
        historySequence: 250n,
      },
      cursorTuple
    ),
    true
  );
});
