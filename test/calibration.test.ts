import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  CALIBRATION_STEPS,
  calibrationDone,
  calibrationRunKey,
  calibrationStepRemainingMs,
  calibrationStepState,
  clearCalibrationRun,
  defaultCalibrationDurations,
  formatCalibrationCountdown,
  nextCalibrationStep,
  normalizeCalibrationMins,
  pendingCalibrationStep,
  readCalibrationDurations,
  readCalibrationRun,
  saveCalibrationDurations,
  startCalibration,
  startCalibrationStep,
  writeCalibrationRun,
} from '../lib/calibration.ts';

/** Stub localStorage minimal (node tidak punya localStorage bawaan). */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const MIN = 60_000;
const T0 = 1_000_000;

describe('Kalibrasi sensor dua tahap (chamber tertutup → dibuka untuk ukur suhu & timbang)', () => {
  const before = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage;
  });
  after(() => {
    globalThis.localStorage = before;
  });

  it('dua langkah baku: 30 menit tertutup, 5 menit dibuka; tidak ada langkah tunggu 15 menit', () => {
    assert.deepEqual(defaultCalibrationDurations(), [30, 5]);
    assert.deepEqual(
      CALIBRATION_STEPS.map((step) => step.defaultMins),
      [30, 5]
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

  it('durasi terakhir tersimpan dan dipakai lagi; nilai rusak jatuh ke bawaan', () => {
    saveCalibrationDurations([25, 7]);
    assert.deepEqual(readCalibrationDurations(), [25, 7]);
    saveCalibrationDurations([999, 'x']);
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
  });

  it('mulai kalibrasi hanya menyalakan langkah 1, langkah 2 menunggu', () => {
    const run = startCalibration([30, 5], T0);
    assert.ok(run);
    assert.deepEqual(run.starts, [T0, null]);
    assert.deepEqual(run.mins, [30, 5]);
    assert.strictEqual(calibrationStepState(run, 0, T0), 'running');
    assert.strictEqual(calibrationStepState(run, 1, T0), 'idle');
    assert.strictEqual(nextCalibrationStep(run), 1);
    assert.strictEqual(calibrationDone(run, T0), false);
  });

  it('langkah berikutnya terkunci sampai langkah sebelumnya benar-benar habis', () => {
    const run = startCalibration([30, 5], T0);
    assert.ok(run);
    // Langkah 2 belum boleh dimulai selama chamber masih tertutup.
    assert.strictEqual(startCalibrationStep(run, 1, 5, T0 + 29 * MIN), null);
    // Langkah 1 tidak bisa dimulai dua kali.
    assert.strictEqual(startCalibrationStep(run, 0, 30, T0 + 30 * MIN), null);
    // Indeks di luar dua langkah ditolak (mis. sisa langkah 3 versi lama).
    assert.strictEqual(startCalibrationStep(run, 2, 15, T0 + 30 * MIN), null);
    // Tepat 30 menit: langkah 2 boleh mulai, dengan durasi isian operator.
    const measuring = startCalibrationStep(run, 1, 7, T0 + 30 * MIN);
    assert.ok(measuring);
    assert.deepEqual(measuring.starts, [T0, T0 + 30 * MIN]);
    assert.deepEqual(measuring.mins, [30, 7]);
  });

  it('kalibrasi selesai setelah 30 + 5 menit, tidak lebih cepat', () => {
    const run = startCalibration([30, 5], T0);
    assert.ok(run);
    const measuring = startCalibrationStep(run, 1, 5, T0 + 30 * MIN);
    assert.ok(measuring);
    assert.strictEqual(calibrationDone(measuring, T0 + 34 * MIN), false);
    assert.strictEqual(calibrationDone(measuring, T0 + 35 * MIN - 1), false);
    assert.strictEqual(calibrationDone(measuring, T0 + 35 * MIN), true);
    assert.strictEqual(calibrationDone(measuring, T0 + 10 * 60 * MIN), true);
    assert.strictEqual(calibrationDone(null, T0), false);
  });

  it('sisa waktu dihitung per langkah dan tidak pernah negatif', () => {
    const run = startCalibration([2, 5], T0);
    assert.ok(run);
    assert.strictEqual(calibrationStepRemainingMs(null, 0, T0), 0);
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0), 2 * MIN);
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0 + MIN), MIN);
    assert.strictEqual(calibrationStepRemainingMs(run, 0, T0 + 9 * MIN), 0);
    // Langkah yang belum dimulai tidak punya hitungan berjalan.
    assert.strictEqual(calibrationStepRemainingMs(run, 1, T0), 0);
  });

  it('langkah yang menahan Start Tahap bisa disebutkan namanya', () => {
    const run = startCalibration([30, 5], T0);
    assert.ok(run);
    assert.strictEqual(pendingCalibrationStep(null, T0), 0);
    assert.strictEqual(pendingCalibrationStep(run, T0), 0);
    const measuring = startCalibrationStep(run, 1, 5, T0 + 30 * MIN);
    assert.ok(measuring);
    assert.strictEqual(pendingCalibrationStep(measuring, T0 + 31 * MIN), 1);
    assert.strictEqual(pendingCalibrationStep(measuring, T0 + 35 * MIN), CALIBRATION_STEPS.length);
  });

  it('kalibrasi berjalan tersimpan dan terbaca kembali', () => {
    const key = calibrationRunKey('BT-1', 'G-SR');
    const run = { mins: [30, 5], starts: [T0, null] };
    writeCalibrationRun(key, run);
    assert.deepEqual(readCalibrationRun(key), run);
    clearCalibrationRun(key);
    assert.strictEqual(readCalibrationRun(key), null);
  });

  it('kunci kalibrasi terpisah per batch dan grup', () => {
    assert.notStrictEqual(calibrationRunKey('BT-1', 'G-SR'), calibrationRunKey('BT-1', 'G-SD'));
    assert.notStrictEqual(calibrationRunKey('BT-1', 'G-SR'), calibrationRunKey('BT-2', 'G-SR'));
  });

  it('kalibrasi rusak, skema lama, atau sisa tiga langkah diabaikan, bukan melempar', () => {
    const key = calibrationRunKey('BT-1', 'G-SR');
    globalThis.localStorage.setItem(key, '{tidak lengkap');
    assert.strictEqual(readCalibrationRun(key), null);
    // Skema v1 (satu durasi) sengaja tidak dibaca: tidak punya jejak tahap 2.
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: 30, startedAtMs: T0 }));
    assert.strictEqual(readCalibrationRun(key), null);
    // Jumlah langkah harus sama dengan CALIBRATION_STEPS (dua).
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: [30], starts: [T0] }));
    assert.strictEqual(readCalibrationRun(key), null);
    // Sisa kalibrasi 3 langkah (versi sebelumnya) tidak dipakai lagi.
    globalThis.localStorage.setItem(
      key,
      JSON.stringify({ mins: [30, 5, 15], starts: [T0, null, null] })
    );
    assert.strictEqual(readCalibrationRun(key), null);
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: [30, 0], starts: [T0, null] }));
    assert.strictEqual(readCalibrationRun(key), null);
    globalThis.localStorage.setItem(
      key,
      JSON.stringify({ mins: [30, 5], starts: [T0, 'x'] })
    );
    assert.strictEqual(readCalibrationRun(key), null);
  });

  it('hitungan mundur tampil mm:ss, dengan jam untuk durasi panjang', () => {
    assert.strictEqual(formatCalibrationCountdown(15 * MIN), '15:00');
    assert.strictEqual(formatCalibrationCountdown(61_000), '01:01');
    assert.strictEqual(formatCalibrationCountdown(1_000), '00:01');
    assert.strictEqual(formatCalibrationCountdown(0), '00:00');
    assert.strictEqual(formatCalibrationCountdown(-5_000), '00:00');
    assert.strictEqual(formatCalibrationCountdown(60 * MIN), '1:00:00');
    assert.strictEqual(formatCalibrationCountdown(61 * MIN + 5_000), '1:01:05');
  });

  it('tanpa localStorage semua operasi aman', () => {
    globalThis.localStorage = undefined as unknown as Storage;
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
    assert.doesNotThrow(() => saveCalibrationDurations([15, 5]));
    assert.strictEqual(readCalibrationRun(calibrationRunKey('BT-1', 'G-SR')), null);
    assert.doesNotThrow(() =>
      writeCalibrationRun(calibrationRunKey('BT-1', 'G-SR'), { mins: [15, 5], starts: [T0, null] })
    );
    assert.doesNotThrow(() => clearCalibrationRun(calibrationRunKey('BT-1', 'G-SR')));
    // Hitungan tetap jalan di memori walau tidak tersimpan.
    const run = startCalibration([15, 5], T0);
    assert.ok(run);
    assert.strictEqual(calibrationStepState(run, 0, T0 + MIN), 'running');
  });
});
