/**
 * Pengujian unit validasi domain dataset (Fase 2, PRD GATE A–D).
 * Murni tanpa I/O, mengikuti pola test/*.test.ts (node:test + assert/strict).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DatasetValidationError,
  MAX_BATCH_PHOTOS,
  MAX_PHOTO_BYTES,
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

  assert.ok(isValidSessionId('SES-20261002-H6-SR'));
  assert.ok(isValidSessionId('SES-20261002-D14-SD'));
  assert.ok(!isValidSessionId('SES-20261002-H6-XX'));
});

test('ID: builder menghasilkan format benar dan menolak input salah', () => {
  const now = new Date('2026-10-02T00:00:00.000Z'); // 07:00 WIB
  assert.strictEqual(buildBatchId(now, 1), 'BT-20261002-01');
  assert.strictEqual(buildGroupId('BT-20261002-01', 'room_temp'), 'BT-20261002-01-SR');
  assert.strictEqual(buildGroupId('BT-20261002-01', 'cold'), 'BT-20261002-01-SD');
  assert.strictEqual(buildSessionId(now, 'H6', 'SR'), 'SES-20261002-H6-SR');

  assert.throws(() => buildBatchId(now, 0), DatasetValidationError);
  assert.throws(() => buildBatchId(now, 100), DatasetValidationError);
  assert.throws(() => buildGroupId('SALAH', 'room_temp'), DatasetValidationError);
  assert.throws(
    () => buildGroupId('BT-20261002-01', 'freezer' as never),
    DatasetValidationError
  );
  assert.throws(() => buildSessionId(now, 'KEMARIN', 'SR'), DatasetValidationError);
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
  const departed = new Date('2026-10-02T00:15:00.000Z');
  const arrivedOk = new Date('2026-10-02T02:00:00.000Z'); // 1h45m
  const arrivedLate = new Date('2026-10-02T04:00:00.000Z'); // 3h45m
  assert.strictEqual(transportDurationMs(departed, arrivedOk), 6_300_000);
  assert.ok(isColdChainCompliant(departed, arrivedOk));
  assert.ok(!isColdChainCompliant(departed, arrivedLate));
  assert.ok(!isColdChainCompliant(arrivedOk, departed)); // terbalik
  assert.ok(isColdChainCompliant(departed, new Date(departed.getTime() + 3 * 3_600_000))); // tepat 3 jam
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

test('Jendela pengadaan: hanya 06:00–08:00 WIB', () => {
  assert.ok(isProcurementWindow(new Date('2026-10-02T00:00:00.000Z'))); // 07:00 WIB
  assert.ok(!isProcurementWindow(new Date('2026-10-01T22:00:00.000Z'))); // 05:00 WIB
  assert.ok(!isProcurementWindow(new Date('2026-10-02T02:00:00.000Z'))); // 09:00 WIB
});

test('Batas foto MVP: 10 file @5MB', () => {
  assert.strictEqual(MAX_BATCH_PHOTOS, 10);
  assert.strictEqual(MAX_PHOTO_BYTES, 5 * 1024 * 1024);
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
  assert.deepStrictEqual(TIMEPOINT_SEQUENCES.cold[1], 'D1');
  for (const seq of Object.values(TIMEPOINT_SEQUENCES)) {
    const hours = seq.map((t) => timepointToElapsedHours(t));
    const sorted = [...hours].sort((a, b) => a - b);
    assert.deepStrictEqual(hours, sorted);
  }
});
