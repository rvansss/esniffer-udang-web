/**
 * Pengujian unit validasi domain dataset (Fase 2, PRD GATE A–D).
 * Murni tanpa I/O, mengikuti pola test/*.test.ts (node:test + assert/strict).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DatasetValidationError,
  isValidBatchId,
  isValidGroupId,
  isValidSessionId,
  buildBatchId,
  buildGroupId,
  buildSessionId,
  parseTimepointCode,
  timepointToElapsedHours,
  compareTimepoints,
  isNextTimepoint,
  transportDurationMs,
  isColdChainCompliant,
  shrinkagePercent,
  isShrinkageAcceptable,
  wibInputToUtc,
  formatWibLabel,
  isProcurementWindow,
} from '../shared/dataset.ts';

test('ID: format batch_id/group_id/session_id valid dan invalid', () => {
  assert.ok(isValidBatchId('BT-20261002-01'));
  assert.ok(!isValidBatchId('SALAH'));
  assert.ok(!isValidBatchId('BT-2026102-01'));
  assert.ok(!isValidBatchId(123));

  assert.ok(isValidGroupId('BT-20261002-01-SR'));
  assert.ok(isValidGroupId('BT-20261002-01-SD'));
  assert.ok(!isValidGroupId('BT-20261002-01-XX'));

  assert.ok(isValidSessionId('SES-20261002-01-H6-SR'));
  assert.ok(isValidSessionId('SES-20261002-01-D14-SD'));
  assert.ok(!isValidSessionId('SES-20261002-01-H6-XX'));
  assert.ok(!isValidSessionId('SES-20261002-H6-SR')); // format lama tanpa nomor batch
});

test('ID: builder menghasilkan format benar dan menolak input salah', () => {
  const now = new Date('2026-10-02T00:00:00.000Z'); // 07:00 WIB
  assert.strictEqual(buildBatchId(now, 1), 'BT-20261002-01');
  assert.strictEqual(buildGroupId('BT-20261002-01', 'room_temp'), 'BT-20261002-01-SR');
  assert.strictEqual(buildGroupId('BT-20261002-01', 'cold'), 'BT-20261002-01-SD');
  assert.strictEqual(buildSessionId('BT-20261002-01', 'H6', 'SR'), 'SES-20261002-01-H6-SR');

  assert.throws(() => buildBatchId(now, 0), DatasetValidationError);
  assert.throws(() => buildBatchId(now, 100), DatasetValidationError);
  assert.throws(() => buildGroupId('SALAH', 'room_temp'), DatasetValidationError);
  assert.throws(
    () => buildGroupId('BT-20261002-01', 'freezer' as never),
    DatasetValidationError
  );
  assert.throws(() => buildSessionId('BT-20261002-01', 'KEMARIN', 'SR'), DatasetValidationError);
  assert.throws(() => buildSessionId('SALAH', 'H6', 'SR'), DatasetValidationError);
});

test('Timepoint: H6=6 jam dan D1=24 jam', () => {
  assert.deepStrictEqual(parseTimepointCode('H0'), { kind: 'H', value: 0 });
  assert.deepStrictEqual(parseTimepointCode('H6'), { kind: 'H', value: 6 });
  assert.deepStrictEqual(parseTimepointCode('D1'), { kind: 'D', value: 1 });
  assert.deepStrictEqual(parseTimepointCode('D14'), { kind: 'D', value: 14 });
  assert.strictEqual(timepointToElapsedHours('H6'), 6);
  assert.strictEqual(timepointToElapsedHours('D1'), 24);
  assert.strictEqual(timepointToElapsedHours('D14'), 336);
  assert.throws(() => parseTimepointCode('KEMARIN'), DatasetValidationError);
  assert.throws(() => timepointToElapsedHours(''), DatasetValidationError);
});

test('Timepoint: monotonik naik dalam satu grup', () => {
  assert.strictEqual(compareTimepoints('H0', 'H6'), -1);
  assert.strictEqual(compareTimepoints('H6', 'H6'), 0);
  assert.strictEqual(compareTimepoints('D1', 'H6'), 1); // 24 > 6
  assert.strictEqual(compareTimepoints('H18', 'D1'), -1); // 18 < 24
  assert.ok(isNextTimepoint('H0', 'H6'));
  assert.ok(isNextTimepoint('H18', 'D1'));
  assert.ok(!isNextTimepoint('H6', 'H6')); // duplikat ditolak
  assert.ok(!isNextTimepoint('H6', 'H0')); // mundur ditolak
});

test('Cold-chain: durasi ≤3 jam lolos, lebih dari itu terdeteksi', () => {
  const start = new Date('2026-10-02T00:15:00.000Z');
  const arrivedOk = new Date('2026-10-02T02:00:00.000Z'); // 1h45m
  const arrivedLate = new Date('2026-10-02T04:00:00.000Z'); // 3h45m
  assert.strictEqual(transportDurationMs(start, arrivedOk), 6_300_000);
  assert.ok(isColdChainCompliant(start, arrivedOk));
  assert.ok(!isColdChainCompliant(start, arrivedLate));
  assert.ok(!isColdChainCompliant(arrivedOk, start)); // terbalik
  assert.ok(isColdChainCompliant(start, new Date(start.getTime() + 3 * 3_600_000))); // tepat 3 jam
});

test('Susut berat: ≤5% lolos, lebih dari itu terdeteksi', () => {
  assert.strictEqual(shrinkagePercent(485.5, 482.0), (3.5 / 485.5) * 100);
  assert.ok(isShrinkageAcceptable(485.5, 482.0)); // ~0.7%
  assert.ok(!isShrinkageAcceptable(485.5, 450.0)); // ~7.3%
  assert.ok(!isShrinkageAcceptable(485.5, 490.0)); // bertambah = anomali
  assert.throws(() => shrinkagePercent(0, 100), DatasetValidationError);
});

test('Waktu: input WIB tersimpan sebagai UTC + label ganda', () => {
  const utc = wibInputToUtc('2026-10-02 07:00');
  assert.strictEqual(utc.toISOString(), '2026-10-02T00:00:00.000Z');
  assert.strictEqual(
    formatWibLabel(utc),
    '2026-10-02 07:00 WIB → tersimpan 2026-10-02T00:00:00.000Z'
  );
  assert.throws(() => wibInputToUtc('02-10-2026 07:00'), DatasetValidationError);
  assert.throws(() => wibInputToUtc('2026-10-02 25:00'), DatasetValidationError);
});

test('Jendela pengadaan: 05:00–08:00 WIB inklusif', () => {
  assert.ok(isProcurementWindow(new Date('2026-10-02T00:00:00.000Z'))); // 07:00 WIB
  assert.ok(isProcurementWindow(new Date('2026-10-01T22:00:00.000Z'))); // 05:00 WIB
  assert.ok(isProcurementWindow(new Date('2026-10-02T01:00:00.000Z'))); // 08:00 WIB
  assert.ok(!isProcurementWindow(new Date('2026-10-01T21:59:00.000Z'))); // 04:59 WIB
  assert.ok(!isProcurementWindow(new Date('2026-10-02T02:00:00.000Z'))); // 09:00 WIB
});

test('Foto: 5 MB hanya peringatan; hard limit 50 MB dan hanya JPG/JPEG/PNG', async () => {
  const {
    PHOTO_WARN_BYTES,
    PHOTO_MAX_BYTES,
    isPhotoOversize,
    isPhotoTooLarge,
    isPhotoFile,
    formatPhotoSize,
    PHOTO_ACCEPT,
  } = await import('../shared/dataset.ts');
  assert.strictEqual(PHOTO_WARN_BYTES, 5 * 1024 * 1024);
  assert.strictEqual(PHOTO_MAX_BYTES, 50 * 1024 * 1024);
  // Di atas 5 MB: peringatan, bukan penolakan. Di atas 50 MB: ditolak.
  assert.strictEqual(isPhotoOversize(PHOTO_WARN_BYTES), false);
  assert.strictEqual(isPhotoOversize(PHOTO_WARN_BYTES + 1), true);
  assert.strictEqual(isPhotoOversize(10 * 1024 * 1024), true);
  assert.strictEqual(isPhotoTooLarge(PHOTO_MAX_BYTES), false);
  assert.strictEqual(isPhotoTooLarge(PHOTO_MAX_BYTES + 1), true);
  assert.strictEqual(isPhotoTooLarge(12 * 1024 * 1024), false);
  // Ekstensi .jpg/.jpeg/.png diterima, termasuk saat tipe MIME kosong/non-standar.
  for (const name of ['a.jpg', 'b.jpeg', 'c.png', 'd.JPG']) {
    assert.strictEqual(isPhotoFile({ type: '', name, size: 1 }), true, name);
  }
  assert.strictEqual(isPhotoFile({ type: 'image/jpg', name: 'x', size: 1 }), true);
  assert.strictEqual(isPhotoFile({ type: 'image/jpeg', name: 'x', size: 1 }), true);
  for (const name of ['a.gif', 'b.heic', 'c.webp', 'd.txt']) {
    assert.strictEqual(isPhotoFile({ type: 'image/gif', name, size: 1 }), false, name);
  }
  assert.strictEqual(isPhotoFile({ type: 'image/jpeg', name: 'kosong.jpg', size: 0 }), false);
  assert.strictEqual(formatPhotoSize(4.2 * 1024 * 1024), '4,2 MB');
  assert.strictEqual(formatPhotoSize(512 * 1024), '512 KB');
  assert.match(PHOTO_ACCEPT, /\.jpeg/);
});

test('Baseline cutoff: 2 menit setelah mulai sesi', async () => {
  const { BASELINE_SECONDS, baselineCutoffUtc } = await import('../shared/dataset.ts');
  assert.strictEqual(BASELINE_SECONDS, 120);
  assert.strictEqual(
    baselineCutoffUtc(new Date('2026-10-02T06:00:00.000Z')).toISOString(),
    '2026-10-02T06:02:00.000Z'
  );
});

test('Urutan timepoint baku per kondisi simpan', async () => {
  const { TIMEPOINT_SEQUENCES } = await import('../shared/dataset.ts');
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.room_temp[1], 'H6');
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.cold[1], 'H12');
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.cold[2], 'H24');
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.cold[3], 'H36');
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.cold[4], 'H48');
  for (const seq of Object.values(TIMEPOINT_SEQUENCES)) {
    const hours = seq.map((t) => timepointToElapsedHours(t));
    const sorted = [...hours].sort((a, b) => a - b);
    assert.deepStrictEqual(hours, sorted);
  }
});
