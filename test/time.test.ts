/**
 * Pengujian logika waktu telemetry dan penanganan data unknown-time
 * Sesuai KF-ING-004, Review Note 2, dan docs/esniffer/03-technical-design.md Section 6.3
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateTelemetryTime,
  isReadingEligibleForChamber,
  TimeValidationError,
} from '../shared/time.ts';
import { type TelemetryPayloadInput } from '../shared/types.ts';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture<T>(filename: string): T {
  const content = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(content) as T;
}

test('evaluateTelemetryTime: Jam tersinkronisasi (SYNCED) dalam toleransi', () => {
  const payload = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const now = new Date('2026-09-30T07:15:35.000Z'); // 3 detik sesudah measured_at

  const result = evaluateTelemetryTime(payload, now);
  assert.strictEqual(result.quality, 'SYNCED');
  assert.strictEqual(result.measuredAt?.toISOString(), '2026-09-30T07:15:32.125Z');
  assert.strictEqual(result.isEligibleForChamber, true);
});

test('evaluateTelemetryTime: Menolak timestamp masa depan melebihi batas toleransi (+2 menit)', () => {
  const payload = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  // Jam server: 10 menit SEBELUM measured_at
  const serverNow = new Date('2026-09-30T07:05:00.000Z');

  assert.throws(
    () => evaluateTelemetryTime(payload, serverNow),
    (err: Error) =>
      err instanceof TimeValidationError &&
      err.reasonCode === 'TIMESTAMP_INVALID' &&
      err.message.includes('too far in the future')
  );
});

test('evaluateTelemetryTime: Menolak backlog yang melampaui batas retensi maksimum (7 hari)', () => {
  const payload = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  // Jam server: 8 hari SESUDAH measured_at
  const serverNow = new Date('2026-10-08T07:15:32.000Z');

  assert.throws(
    () => evaluateTelemetryTime(payload, serverNow),
    (err: Error) =>
      err instanceof TimeValidationError &&
      err.reasonCode === 'BACKLOG_EXPIRED' &&
      err.message.includes('older than allowed backlog limit')
  );
});

test('evaluateTelemetryTime: Rekonstruksi waktu berhasil dari anchor boot yang sama (RECONSTRUCTED)', () => {
  const payload = loadFixture<TelemetryPayloadInput>('backlog-reconstructed.json');
  const serverNow = new Date('2026-09-30T07:16:00.000Z');

  const result = evaluateTelemetryTime(payload, serverNow);
  assert.strictEqual(result.quality, 'RECONSTRUCTED');
  assert.ok(result.measuredAt !== null);

  // Periksa perhitungan:
  // anchor_utc: 2026-09-30T07:15:30.000Z, anchor_uptime: 185200 ms
  // sample_uptime: 12000 ms
  // delta = 12000 - 185200 = -173200 ms (-173.2 detik)
  // expected: 07:15:30 - 173.2s = 07:12:36.800Z
  assert.strictEqual(result.measuredAt.toISOString(), '2026-09-30T07:12:36.800Z');
  assert.strictEqual(result.uncertaintyMs, 50);
  assert.strictEqual(result.isEligibleForChamber, true);
});

test('Review Note 2: Rekonstruksi ditolak jika boot_id anchor berbeda', () => {
  const payload = loadFixture<TelemetryPayloadInput>('backlog-unknown-time.json');
  const serverNow = new Date('2026-09-30T07:16:00.000Z');

  const storedAnchorDifferentBoot = {
    reference_id: 'ntp-other',
    boot_id: '11111111-2222-3333-4444-555555555555', // Berbeda dari boot_id payload
    anchor_utc: '2026-09-30T07:15:30.000Z',
    anchor_uptime_ms: 185200,
    uncertainty_ms: 50,
    source: 'ntp',
  };

  const result = evaluateTelemetryTime(payload, serverNow, storedAnchorDifferentBoot);
  // Harus menghasilkan UNKNOWN dan measuredAt tetap null
  assert.strictEqual(result.quality, 'UNKNOWN');
  assert.strictEqual(result.measuredAt, null);
  assert.strictEqual(result.isEligibleForChamber, false);
});

test('Review Note 2: Data unknown-time TIDAK PERNAH memakai server received_at sebagai pengganti', () => {
  const payload = loadFixture<TelemetryPayloadInput>('backlog-unknown-time.json');
  const serverReceivedAt = new Date('2026-09-30T07:20:00.000Z');

  const result = evaluateTelemetryTime(payload, serverReceivedAt);

  assert.strictEqual(result.quality, 'UNKNOWN');
  assert.strictEqual(result.measuredAt, null);
  assert.notStrictEqual(result.measuredAt, serverReceivedAt);
  assert.strictEqual(result.isEligibleForChamber, false);

  // Visibility: reading unknown-time tidak diizinkan masuk tampilan chamber
  assert.strictEqual(isReadingEligibleForChamber(result.quality, 'chamber-123'), false);
  assert.strictEqual(isReadingEligibleForChamber('SYNCED', 'chamber-123'), true);
  assert.strictEqual(isReadingEligibleForChamber('RECONSTRUCTED', 'chamber-123'), true);
});
