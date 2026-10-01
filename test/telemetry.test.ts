/**
 * Pengujian kontrak Telemetry:
 * T-ING-02: Penolakan error struktur
 * T-ING-03: Penerimaan kegagalan sensor parsial (null+quality tanpa menolak paket)
 * Sesuai KF-ING-002, KF-ING-003, dan docs/esniffer/04-implementation-plan.md
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateTelemetryPayload,
  normalizeSensors,
  TelemetryValidationError,
} from '../shared/telemetry-schema.ts';
import { type TelemetryPayloadInput } from '../shared/types.ts';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture<T>(filename: string): T {
  const content = readFileSync(join(fixturesDir, filename), 'utf8');
  return JSON.parse(content) as T;
}

test('T-ING-01: Menerima paket telemetry valid', () => {
  const valid = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const result = validateTelemetryPayload(valid, 'esp32-001');

  assert.strictEqual(result.device_id, 'esp32-001');
  assert.strictEqual(result.sequence, 42);
  assert.strictEqual(result.clock_synced, true);

  const normalized = normalizeSensors(result.sensors);
  assert.strictEqual(normalized.temperature_c.quality, 'OK');
  assert.strictEqual(normalized.temperature_c.value, 27.125);
  assert.strictEqual(normalized.humidity_percent.quality, 'OK');
  assert.strictEqual(normalized.mq137_raw.quality, 'OK');
  assert.strictEqual(normalized.mq136_raw.quality, 'OK');
  assert.strictEqual(normalized.mq4_raw.quality, 'OK');
});

test('T-ING-02: Menolak error struktur - string angka untuk nilai sensor', () => {
  const invalid = loadFixture<unknown>('invalid-structural-type.json');
  assert.throws(
    () => validateTelemetryPayload(invalid, 'esp32-001'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'SCHEMA_INVALID' &&
      err.message.includes('finite JSON number')
  );
});

test('T-ING-02: Menolak error struktur - ketidakcocokan topic device_id dan payload device_id', () => {
  const valid = loadFixture<unknown>('valid-telemetry.json');
  assert.throws(
    () => validateTelemetryPayload(valid, 'esp32-different-device'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'TOPIC_MISMATCH'
  );
});

test('T-ING-02: Menolak error struktur - sensor wajib hilang', () => {
  const valid = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const missingSensor = JSON.parse(JSON.stringify(valid));
  delete missingSensor.sensors.mq137_raw;

  assert.throws(
    () => validateTelemetryPayload(missingSensor, 'esp32-001'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'SCHEMA_INVALID' &&
      err.message.includes('Missing required sensor key')
  );
});

test('T-ING-02: Menolak error struktur - properti sensor asing tidak dikenal', () => {
  const valid = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const extraSensor = JSON.parse(JSON.stringify(valid));
  extraSensor.sensors.unknown_sensor = { value: 100, quality: 'ok' };

  assert.throws(
    () => validateTelemetryPayload(extraSensor, 'esp32-001'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'SCHEMA_INVALID' &&
      err.message.includes('Unexpected extra sensor key')
  );
});

test('T-ING-02: Menolak error struktur - message_id tidak konsisten dengan boot_id dan sequence', () => {
  const valid = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const badMessageId = JSON.parse(JSON.stringify(valid));
  badMessageId.message_id = 'different-boot-id:999';

  assert.throws(
    () => validateTelemetryPayload(badMessageId, 'esp32-001'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'SCHEMA_INVALID' &&
      err.message.includes('must start with boot_id')
  );
});

test('T-ING-02: Menolak error struktur - quality bukan ok tapi nilai tidak null', () => {
  const valid = loadFixture<TelemetryPayloadInput>('valid-telemetry.json');
  const badSensor = JSON.parse(JSON.stringify(valid));
  badSensor.sensors.mq136_raw = { value: 1234, quality: 'sensor_error' };

  assert.throws(
    () => validateTelemetryPayload(badSensor, 'esp32-001'),
    (err: Error) =>
      err instanceof TelemetryValidationError &&
      err.reasonCode === 'SCHEMA_INVALID' &&
      err.message.includes('must have value: null')
  );
});

test('T-ING-03: Satu sensor gagal dilaporkan (sensor_error) disimpan sebagai null+quality tanpa menolak paket', () => {
  const partialFailure = loadFixture<TelemetryPayloadInput>('sensor-partial-failure.json');

  // Paket lolos validasi struktur
  const validated = validateTelemetryPayload(partialFailure, 'esp32-001');
  assert.ok(validated);

  // Normalisasi menghasilkan SENSOR_ERROR untuk mq136_raw dengan value null
  const normalized = normalizeSensors(validated.sensors);
  assert.strictEqual(normalized.mq136_raw.quality, 'SENSOR_ERROR');
  assert.strictEqual(normalized.mq136_raw.value, null);

  // 4 sensor lainnya tetap bernilai OK
  assert.strictEqual(normalized.temperature_c.quality, 'OK');
  assert.strictEqual(normalized.temperature_c.value, 27.2);
  assert.strictEqual(normalized.humidity_percent.quality, 'OK');
  assert.strictEqual(normalized.mq137_raw.quality, 'OK');
  assert.strictEqual(normalized.mq4_raw.quality, 'OK');
});

test('T-ING-03: Nilai sensor di luar batas server dinormalisasi menjadi null+OUT_OF_RANGE tanpa menolak paket', () => {
  const outOfRange = loadFixture<TelemetryPayloadInput>('sensor-out-of-range.json');

  // Paket valid secara struktur
  const validated = validateTelemetryPayload(outOfRange, 'esp32-001');
  assert.ok(validated);

  // Suhu 120.0 C melampaui batas server [-40, 85]
  const normalized = normalizeSensors(validated.sensors);
  assert.strictEqual(normalized.temperature_c.quality, 'OUT_OF_RANGE');
  assert.strictEqual(normalized.temperature_c.value, null);

  // Sensor lain yang dalam batas tetap OK
  assert.strictEqual(normalized.humidity_percent.quality, 'OK');
  assert.strictEqual(normalized.humidity_percent.value, 78.0);
});
