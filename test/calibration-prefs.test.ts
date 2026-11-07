import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  saveCalibrationDurations,
  readCalibrationDurations,
} from '../lib/calibration-prefs.ts';
import { defaultCalibrationDurations } from '../lib/calibration.ts';

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

/**
 * Preferensi durasi adalah satu-satunya bagian kalibrasi yang masih perangkat
 * (localStorage); status kalibrasi ada di server. Test ini memastikan
 * preferensi tidak pernah membuat fitur gagal: nilai rusak/hilang jatuh ke
 * durasi bawaan protokol.
 */
describe('Preferensi durasi kalibrasi per perangkat', () => {
  const before = globalThis.localStorage;
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage;
  });
  after(() => {
    globalThis.localStorage = before;
  });

  it('tanpa nilai tersimpan, durasi bawaan protokol yang dipakai', () => {
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
    assert.deepEqual(readCalibrationDurations(), defaultCalibrationDurations());
  });

  it('durasi terakhir tersimpan dan dipakai lagi; nilai rusak jatuh ke bawaan', () => {
    saveCalibrationDurations([25, 7]);
    assert.deepEqual(readCalibrationDurations(), [25, 7]);
    saveCalibrationDurations([999, 'x']);
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
  });

  it('JSON rusak atau bentuk lama diabaikan tanpa melempar', () => {
    globalThis.localStorage.setItem('esniffer:calibration:durations-v2', '{tidak lengkap');
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
    globalThis.localStorage.setItem('esniffer:calibration:durations-v2', JSON.stringify([30]));
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
  });

  it('localStorage tidak tersedia: semua operasi tetap aman', () => {
    globalThis.localStorage = undefined as unknown as Storage;
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
    assert.deepEqual(saveCalibrationDurations([20, 10]), [20, 10]);
    assert.deepEqual(readCalibrationDurations(), [30, 5]);
  });
});
