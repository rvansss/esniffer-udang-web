import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CALIBRATION_STEPS,
  calibrationDone,
  calibrationStepRemainingMs,
  calibrationStepState,
  defaultCalibrationDurations,
  formatCalibrationCountdown,
  nextCalibrationStep,
  normalizeCalibrationMins,
  pendingCalibrationStep,
  runFromStoredSteps,
  runFromWire,
  runToWireSteps,
  startCalibration,
  startCalibrationStep,
  type CalibrationRun,
} from '../lib/calibration.ts';

const MIN = 60_000;
const T0 = 1_000_000;

/**
 * Kalibrasi dua tahap kini murni fungsi waktu: yang disimpan server adalah
 * waktu mulai absolut per langkah, jadi hitungan di semua perangkat identik.
 * Test ini menjaga aritmetika dan bentuk wire-nya, bukan localStorage lagi.
 */
describe('Kalibrasi sensor dua tahap (chamber tertutup → dibuka untuk ukur suhu & timbang)', () => {
  it('dua langkah baku: 30 menit tertutup, 5 menit dibuka; tidak ada langkah tunggu 15 menit', () => {
    assert.deepEqual(defaultCalibrationDurations(), [30, 5]);
    assert.deepEqual(
      CALIBRATION_STEPS.map((step) => step.defaultMins),
      [30, 5]
    );
    assert.deepEqual(
      CALIBRATION_STEPS.map((step) => step.key),
      ['closed', 'measure']
    );
  });

  it('durasi sah hanya bilangan bulat 1..120 menit', () => {
    for (const [value, expected] of [
      [15, 15],
      ['30', 30],
      [' 45 ', 45],
      [1, 1],
      [120, 120],
    ] as Array<[unknown, number]>) {
      assert.strictEqual(normalizeCalibrationMins(value), expected);
    }
    for (const bad of [0, 121, -5, 12.5, '', ' ', 'abc', null, undefined, true, NaN]) {
      assert.strictEqual(normalizeCalibrationMins(bad), null, `nilai ${String(bad)} harus ditolak`);
    }
  });

  it('mulai kalibrasi: hanya langkah 1 yang berjalan, langkah 2 belum dimulai', () => {
    const run = startCalibration([30, 5], T0);
    assert.ok(run);
    assert.deepEqual(run.starts, [T0, null]);
    assert.deepEqual(run.mins, [30, 5]);
    assert.strictEqual(calibrationStepState(run, 0, T0), 'running');
    assert.strictEqual(calibrationStepState(run, 1, T0), 'idle');
    assert.strictEqual(calibrationDone(run, T0), false);
  });

  it('langkah 2 ditolak sebelum langkah 1 habis, lalu diterima setelahnya', () => {
    const run = startCalibration([30, 5], T0) as CalibrationRun;
    assert.strictEqual(startCalibrationStep(run, 1, 5, T0 + 29 * MIN), null, '29 menit belum habis');
    const later = startCalibrationStep(run, 1, 5, T0 + 30 * MIN);
    assert.ok(later, 'tepat 30 menit langkah 1 selesai');
    assert.deepEqual(later.starts, [T0, T0 + 30 * MIN]);
    assert.strictEqual(calibrationStepState(later, 1, T0 + 30 * MIN), 'running');
  });

  it('tidak boleh melompati urutan langkah', () => {
    const run = startCalibration([30, 5], T0) as CalibrationRun;
    assert.strictEqual(startCalibrationStep(run, 1, 5, T0), null, 'langkah 2 bukan langkah berikutnya');
    assert.strictEqual(startCalibrationStep(run, 0, 30, T0), null, 'langkah 1 sudah dimulai');
    assert.strictEqual(nextCalibrationStep(run), 1);
  });

  it('selesai hanya bila kedua langkah dimulai dan hitungannya habis', () => {
    const run = startCalibration([30, 5], T0) as CalibrationRun;
    assert.strictEqual(calibrationDone(run, T0 + 100 * MIN), false, 'langkah 2 belum dimulai');
    const both = startCalibrationStep(run, 1, 5, T0 + 30 * MIN) as CalibrationRun;
    assert.strictEqual(calibrationDone(both, T0 + 34 * MIN), false);
    assert.strictEqual(calibrationDone(both, T0 + 35 * MIN), true);
    assert.strictEqual(pendingCalibrationStep(both, T0 + 35 * MIN), 2);
  });

  it('sisa waktu satu langkah dihitung dari waktu mulai absolut', () => {
    const run = startCalibration([30, 5], T0) as CalibrationRun;
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0), 30 * MIN);
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0 + 10 * MIN), 20 * MIN);
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0 + 31 * MIN), 0, 'tidak negatif');
    assert.strictEqual(calibrationStepRemainingMs(run, 1, T0), 0, 'belum dimulai = 0');
    assert.strictEqual(calibrationStepRemainingMs(null, 0, T0), 0);
  });

  it('durasi milidetik dibulatkan ke atas pada tampilan mm:ss (dan jam bila perlu)', () => {
    assert.strictEqual(formatCalibrationCountdown(90_000), '01:30');
    assert.strictEqual(formatCalibrationCountdown(1_800_000), '30:00');
    assert.strictEqual(formatCalibrationCountdown(3_725_000), '1:02:05');
    assert.strictEqual(formatCalibrationCountdown(0), '00:00');
    assert.strictEqual(formatCalibrationCountdown(-1000), '00:00');
  });

  it('bentuk wire bolak-balik mempertahankan waktu mulai absolut (dasar sinkron antarperangkat)', () => {
    const run = startCalibration([30, 5], T0) as CalibrationRun;
    const steps = runToWireSteps(run);
    assert.strictEqual(steps[0].key, 'closed');
    assert.strictEqual(steps[0].durationMins, 30);
    assert.strictEqual(steps[0].startedAtUtc, new Date(T0).toISOString());
    assert.strictEqual(steps[1].startedAtUtc, null);

    const parsed = runFromWire({
      steps,
      completedAtUtc: null,
      version: 1,
      updatedAt: new Date(T0).toISOString(),
      updatedByOperator: 'Budi',
      updatedByDevice: 'Chrome · Android',
    });
    assert.deepEqual(parsed, run, 'waktu mulai yang sama menghasilkan hitungan yang sama di perangkat lain');
  });

  it('wire rusak ditolak, bukan dihitung dari data yang tidak bisa dipercaya', () => {
    const valid = runToWireSteps(startCalibration([30, 5], T0) as CalibrationRun);
    const base = {
      completedAtUtc: null,
      version: 1,
      updatedAt: new Date(T0).toISOString(),
      updatedByOperator: null,
      updatedByDevice: null,
    };
    assert.strictEqual(runFromWire({ ...base, steps: valid.slice(0, 1) }), null, 'jumlah langkah kurang');
    assert.strictEqual(
      runFromWire({ ...base, steps: [{ ...valid[1] }, { ...valid[0] }] }),
      null,
      'urutan langkah tertukar'
    );
    assert.strictEqual(
      runFromWire({ ...base, steps: [{ ...valid[0], durationMins: 0 }, valid[1]] }),
      null,
      'durasi di luar batas'
    );
    assert.strictEqual(
      runFromWire({ ...base, steps: [{ ...valid[0], startedAtUtc: 'bukan tanggal' }, valid[1]] }),
      null,
      'tanggal rusak'
    );
    assert.strictEqual(runFromWire(null), null);
  });

  it('JSON tersimpan di DB divalidasi dengan aturan yang sama', () => {
    const steps = runToWireSteps(startCalibration([30, 5], T0) as CalibrationRun);
    assert.deepEqual(runFromStoredSteps(steps), { mins: [30, 5], starts: [T0, null] });
    assert.strictEqual(runFromStoredSteps('bukan array'), null);
    assert.strictEqual(runFromStoredSteps([{ key: 'closed', durationMins: 30, startedAtUtc: null }]), null);
    assert.strictEqual(
      runFromStoredSteps([{ key: 'salah', durationMins: 30, startedAtUtc: null }, steps[1]]),
      null
    );
  });
});
