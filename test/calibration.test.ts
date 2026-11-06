import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  CALIBRATION_DEFAULT_MINS,
  CALIBRATION_HISTORY_LIMIT,
  calibrationDone,
  calibrationRemainingMs,
  calibrationRunKey,
  clearCalibrationRun,
  formatCalibrationCountdown,
  normalizeCalibrationMins,
  readCalibrationHistory,
  readCalibrationRun,
  rememberCalibrationMins,
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

describe('Kalibrasi sensor (pengganti checkbox warmup 30 menit)', () => {
  const before = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage;
  });
  after(() => {
    globalThis.localStorage = before;
  });

  it('durasi sah hanya bilangan bulat 1..120 menit', () => {
    const valid: Array<[unknown, number]> = [
      [15, 15],
      ['30', 30],
      [' 45 ', 45],
      [1, 1],
      [120, 120],
      [CALIBRATION_DEFAULT_MINS, 30],
    ];
    for (const [value, expected] of valid) {
      assert.strictEqual(normalizeCalibrationMins(value), expected);
    }
    for (const bad of [0, 121, -5, 12.5, '', ' ', 'abc', null, undefined, true, NaN]) {
      assert.strictEqual(normalizeCalibrationMins(bad), null, `nilai ${String(bad)} harus ditolak`);
    }
  });

  it('riwayat menyimpan yang terbaru lebih dulu, tanpa duplikat', () => {
    rememberCalibrationMins(30);
    rememberCalibrationMins(15);
    rememberCalibrationMins(30);
    assert.deepEqual(readCalibrationHistory(), [30, 15]);
  });

  it('riwayat dipotong ke batas pilihan cepat', () => {
    for (const mins of [10, 20, 30, 40, 50, 60]) rememberCalibrationMins(mins);
    assert.strictEqual(readCalibrationHistory().length, CALIBRATION_HISTORY_LIMIT);
    assert.deepEqual(readCalibrationHistory(), [60, 50, 40, 30]);
  });

  it('durasi tidak sah tidak mengotori riwayat', () => {
    rememberCalibrationMins(15);
    assert.deepEqual(rememberCalibrationMins(999), [15]);
    assert.deepEqual(readCalibrationHistory(), [15]);
  });

  it('kalibrasi berjalan tersimpan dan terbaca kembali', () => {
    const key = calibrationRunKey('BT-1', 'G-SR');
    writeCalibrationRun(key, { mins: 15, startedAtMs: 1_000 });
    assert.deepEqual(readCalibrationRun(key), { mins: 15, startedAtMs: 1_000 });
    clearCalibrationRun(key);
    assert.strictEqual(readCalibrationRun(key), null);
  });

  it('kunci kalibrasi terpisah per batch dan grup', () => {
    assert.notStrictEqual(
      calibrationRunKey('BT-1', 'G-SR'),
      calibrationRunKey('BT-1', 'G-SD'),
    );
    assert.notStrictEqual(
      calibrationRunKey('BT-1', 'G-SR'),
      calibrationRunKey('BT-2', 'G-SR'),
    );
  });

  it('kalibrasi rusak atau berskema asing diabaikan, bukan melempar', () => {
    const key = calibrationRunKey('BT-1', 'G-SR');
    globalThis.localStorage.setItem(key, '{tidak lengkap');
    assert.strictEqual(readCalibrationRun(key), null);
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: 0, startedAtMs: 1_000 }));
    assert.strictEqual(readCalibrationRun(key), null);
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: 15 }));
    assert.strictEqual(readCalibrationRun(key), null);
    globalThis.localStorage.setItem(key, JSON.stringify({ mins: 15, startedAtMs: Number.NaN }));
    assert.strictEqual(readCalibrationRun(key), null);
  });

  it('belum mulai = belum selesai; tepat habis = selesai', () => {
    const start = 1_000_000;
    const run = { mins: 15, startedAtMs: start };
    assert.strictEqual(calibrationDone(null, start), false);
    assert.strictEqual(calibrationDone(run, start), false);
    assert.strictEqual(calibrationDone(run, start + 15 * 60_000 - 1), false);
    assert.strictEqual(calibrationDone(run, start + 15 * 60_000), true);
    assert.strictEqual(calibrationDone(run, start + 10 * 60 * 60_000), true);
  });

  it('sisa waktu tidak pernah negatif', () => {
    const run = { mins: 2, startedAtMs: 0 };
    assert.strictEqual(calibrationRemainingMs(null, 5), 0);
    assert.strictEqual(calibrationRemainingMs(run, 0), 120_000);
    assert.strictEqual(calibrationRemainingMs(run, 60_000), 60_000);
    assert.strictEqual(calibrationRemainingMs(run, 999_999), 0);
  });

  it('hitungan mundur tampil mm:ss, dengan jam untuk durasi panjang', () => {
    assert.strictEqual(formatCalibrationCountdown(15 * 60_000), '15:00');
    assert.strictEqual(formatCalibrationCountdown(61_000), '01:01');
    assert.strictEqual(formatCalibrationCountdown(1_000), '00:01');
    assert.strictEqual(formatCalibrationCountdown(0), '00:00');
    assert.strictEqual(formatCalibrationCountdown(-5_000), '00:00');
    assert.strictEqual(formatCalibrationCountdown(60 * 60_000), '1:00:00');
    assert.strictEqual(formatCalibrationCountdown(61 * 60_000 + 5_000), '1:01:05');
  });

  it('tanpa localStorage semua operasi aman', () => {
    globalThis.localStorage = undefined as unknown as Storage;
    assert.doesNotThrow(() => rememberCalibrationMins(15));
    // Tetap mengembalikan chip untuk sesi ini, hanya tidak diingat.
    assert.deepEqual(rememberCalibrationMins(20), [20]);
    assert.deepEqual(readCalibrationHistory(), []);
    assert.strictEqual(readCalibrationRun(calibrationRunKey('BT-1', 'G-SR')), null);
    assert.doesNotThrow(() => writeCalibrationRun(calibrationRunKey('BT-1', 'G-SR'), { mins: 5, startedAtMs: 1 }));
    assert.doesNotThrow(() => clearCalibrationRun(calibrationRunKey('BT-1', 'G-SR')));
  });
});
