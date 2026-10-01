/**
 * Validator skema telemetry MQTT v1 dan normalisasi sensor
 * Sesuai KF-ING-001, KF-ING-002 (T-ING-02), dan KF-ING-003 (T-ING-03)
 * docs/esniffer/02-skpl.md & docs/esniffer/03-technical-design.md Section 6.2
 */

import {
  SCHEMA_VERSION,
  type TelemetryPayloadInput,
  type NormalizedSensors,
  type InputSensorQuality,
  type AckRejectReason,
} from './types.ts';
import { REQUIRED_SENSOR_KEYS, isSensorValueInRange } from './units.ts';
import { isValidDeviceId } from './topic.ts';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const RFC3339_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export class TelemetryValidationError extends Error {
  public readonly reasonCode: AckRejectReason;
  constructor(message: string, reasonCode: AckRejectReason = 'SCHEMA_INVALID') {
    super(message);
    this.name = 'TelemetryValidationError';
    this.reasonCode = reasonCode;
  }
}

/**
 * Memvalidasi apakah string merupakan format tanggal RFC 3339 valid
 */
export function isValidRfc3339(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string') return false;
  if (!RFC3339_REGEX.test(dateStr)) return false;
  const time = Date.parse(dateStr);
  return !Number.isNaN(time);
}

/**
 * Memvalidasi apakah string merupakan UUID valid
 */
export function isValidUuid(uuid: unknown): boolean {
  return typeof uuid === 'string' && UUID_REGEX.test(uuid);
}

/**
 * Validasi ketat terhadap payload telemetry:
 * - Menolak struktur salah, tipe salah, NaN, string angka, missing keys, extra keys.
 * - Memastikan kesesuaian antara topicDeviceId dan payload.device_id.
 * - Memvalidasi format message_id = boot_id:sequence.
 */
export function validateTelemetryPayload(
  payload: unknown,
  topicDeviceId?: string
): TelemetryPayloadInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TelemetryValidationError('Telemetry payload must be a JSON object', 'SCHEMA_INVALID');
  }

  const p = payload as Record<string, unknown>;

  // 1. schema_version
  if (p.schema_version !== SCHEMA_VERSION) {
    throw new TelemetryValidationError(
      `Unsupported schema_version: ${p.schema_version}. Expected ${SCHEMA_VERSION}`,
      'SCHEMA_INVALID'
    );
  }

  // 2. device_id
  if (typeof p.device_id !== 'string' || !isValidDeviceId(p.device_id)) {
    throw new TelemetryValidationError(`Invalid device_id in payload: "${p.device_id}"`, 'SCHEMA_INVALID');
  }

  // 3. Cocokkan dengan topic device_id bila tersedia
  if (topicDeviceId !== undefined && p.device_id !== topicDeviceId) {
    throw new TelemetryValidationError(
      `Topic device_id "${topicDeviceId}" does not match payload device_id "${p.device_id}"`,
      'TOPIC_MISMATCH'
    );
  }

  // 4. boot_id
  if (!isValidUuid(p.boot_id)) {
    throw new TelemetryValidationError(`Invalid boot_id: "${p.boot_id}". Must be a valid UUID`, 'SCHEMA_INVALID');
  }

  // 5. sequence
  if (
    typeof p.sequence !== 'number' ||
    !Number.isSafeInteger(p.sequence) ||
    p.sequence < 0
  ) {
    throw new TelemetryValidationError(
      `Invalid sequence: ${p.sequence}. Must be a non-negative integer`,
      'SCHEMA_INVALID'
    );
  }

  // 6. message_id format: boot_id:sequence
  if (typeof p.message_id !== 'string') {
    throw new TelemetryValidationError('message_id must be a string', 'SCHEMA_INVALID');
  }
  const expectedPrefix = `${p.boot_id}:`;
  if (!p.message_id.startsWith(expectedPrefix)) {
    throw new TelemetryValidationError(
      `message_id "${p.message_id}" must start with boot_id "${p.boot_id}:"`,
      'SCHEMA_INVALID'
    );
  }
  const seqSuffix = p.message_id.slice(expectedPrefix.length);
  const parsedSeq = parseInt(seqSuffix, 10);
  if (Number.isNaN(parsedSeq) || parsedSeq !== p.sequence) {
    throw new TelemetryValidationError(
      `message_id sequence suffix "${seqSuffix}" does not match sequence ${p.sequence}`,
      'SCHEMA_INVALID'
    );
  }

  // 7. sample_uptime_ms
  if (
    typeof p.sample_uptime_ms !== 'number' ||
    !Number.isSafeInteger(p.sample_uptime_ms) ||
    p.sample_uptime_ms < 0
  ) {
    throw new TelemetryValidationError(
      `Invalid sample_uptime_ms: ${p.sample_uptime_ms}. Must be a non-negative integer`,
      'SCHEMA_INVALID'
    );
  }

  // 8. clock_synced & measured_at
  if (typeof p.clock_synced !== 'boolean') {
    throw new TelemetryValidationError('clock_synced must be a boolean', 'SCHEMA_INVALID');
  }

  if (p.clock_synced) {
    if (!isValidRfc3339(p.measured_at)) {
      throw new TelemetryValidationError(
        `measured_at must be a valid RFC 3339 timestamp when clock_synced is true: "${p.measured_at}"`,
        'TIMESTAMP_INVALID'
      );
    }
  } else {
    if (p.measured_at !== null) {
      throw new TelemetryValidationError(
        'measured_at must be null when clock_synced is false',
        'SCHEMA_INVALID'
      );
    }
  }

  // 9. time_reference (opsional)
  if (p.time_reference !== undefined && p.time_reference !== null) {
    if (typeof p.time_reference !== 'object' || Array.isArray(p.time_reference)) {
      throw new TelemetryValidationError('time_reference must be an object or null', 'SCHEMA_INVALID');
    }
    const tr = p.time_reference as Record<string, unknown>;
    if (typeof tr.reference_id !== 'string' || tr.reference_id.trim() === '') {
      throw new TelemetryValidationError('time_reference.reference_id must be a non-empty string', 'SCHEMA_INVALID');
    }
    if (!isValidRfc3339(tr.anchor_utc)) {
      throw new TelemetryValidationError('time_reference.anchor_utc must be a valid RFC 3339 timestamp', 'SCHEMA_INVALID');
    }
    if (typeof tr.anchor_uptime_ms !== 'number' || !Number.isSafeInteger(tr.anchor_uptime_ms) || tr.anchor_uptime_ms < 0) {
      throw new TelemetryValidationError('time_reference.anchor_uptime_ms must be a non-negative integer', 'SCHEMA_INVALID');
    }
    if (typeof tr.uncertainty_ms !== 'number' || !Number.isSafeInteger(tr.uncertainty_ms) || tr.uncertainty_ms < 0) {
      throw new TelemetryValidationError('time_reference.uncertainty_ms must be a non-negative integer', 'SCHEMA_INVALID');
    }
    if (typeof tr.source !== 'string' || tr.source.trim() === '') {
      throw new TelemetryValidationError('time_reference.source must be a non-empty string', 'SCHEMA_INVALID');
    }
  }

  // 10. firmware_version (opsional)
  if (p.firmware_version !== undefined && p.firmware_version !== null) {
    if (typeof p.firmware_version !== 'string' || p.firmware_version.length > 64) {
      throw new TelemetryValidationError('firmware_version must be a string <= 64 characters', 'SCHEMA_INVALID');
    }
  }

  // 11. sensors object
  if (!p.sensors || typeof p.sensors !== 'object' || Array.isArray(p.sensors)) {
    throw new TelemetryValidationError('sensors must be an object', 'SCHEMA_INVALID');
  }

  const s = p.sensors as Record<string, unknown>;
  const sensorKeys = Object.keys(s);

  // Pastikan tidak ada missing sensor keys
  for (const requiredKey of REQUIRED_SENSOR_KEYS) {
    if (!(requiredKey in s)) {
      throw new TelemetryValidationError(`Missing required sensor key: "${requiredKey}"`, 'SCHEMA_INVALID');
    }
  }

  // Pastikan tidak ada extra sensor keys asing
  for (const key of sensorKeys) {
    if (!REQUIRED_SENSOR_KEYS.includes(key as typeof REQUIRED_SENSOR_KEYS[number])) {
      throw new TelemetryValidationError(`Unexpected extra sensor key: "${key}"`, 'SCHEMA_INVALID');
    }
  }

  // Validasi struktur tiap sensor
  const validQualities: InputSensorQuality[] = ['ok', 'sensor_error', 'out_of_range', 'missing'];

  for (const key of REQUIRED_SENSOR_KEYS) {
    const sensorObj = s[key];
    if (!sensorObj || typeof sensorObj !== 'object' || Array.isArray(sensorObj)) {
      throw new TelemetryValidationError(`Sensor "${key}" must be an object with value and quality`, 'SCHEMA_INVALID');
    }
    const { value, quality } = sensorObj as Record<string, unknown>;

    if (typeof quality !== 'string' || !validQualities.includes(quality as InputSensorQuality)) {
      throw new TelemetryValidationError(
        `Invalid quality "${quality}" for sensor "${key}". Allowed: ok, sensor_error, out_of_range, missing`,
        'SCHEMA_INVALID'
      );
    }

    if (quality === 'ok') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TelemetryValidationError(
          `Sensor "${key}" with quality "ok" requires a finite JSON number, got ${typeof value === 'number' ? 'NaN/Infinity' : typeof value}`,
          'SCHEMA_INVALID'
        );
      }
    } else {
      if (value !== null) {
        throw new TelemetryValidationError(
          `Sensor "${key}" with quality "${quality}" must have value: null, got ${value}`,
          'SCHEMA_INVALID'
        );
      }
    }
  }

  return payload as TelemetryPayloadInput;
}

/**
 * Melakukan normalisasi sensor (T-ING-03):
 * - Sensor dengan quality 'ok' dan nilai dalam batas server menjadi { value, quality: 'OK' }.
 * - Sensor dengan quality 'ok' tapi nilai di luar batas server dinormalisasi menjadi { value: null, quality: 'OUT_OF_RANGE' }.
 * - Sensor dengan quality error device dinormalisasi menjadi { value: null, quality: SENSOR_ERROR / OUT_OF_RANGE / MISSING }.
 * - Menjaga paket tetap valid dan tidak menolak paket hanya karena satu sensor gagal.
 */
export function normalizeSensors(sensors: TelemetryPayloadInput['sensors']): NormalizedSensors {
  const result: Partial<NormalizedSensors> = {};

  for (const key of REQUIRED_SENSOR_KEYS) {
    const input = sensors[key];
    if (input.quality === 'ok') {
      const numVal = input.value as number;
      if (isSensorValueInRange(key, numVal)) {
        result[key] = { value: numVal, quality: 'OK' };
      } else {
        result[key] = { value: null, quality: 'OUT_OF_RANGE' };
      }
    } else if (input.quality === 'sensor_error') {
      result[key] = { value: null, quality: 'SENSOR_ERROR' };
    } else if (input.quality === 'out_of_range') {
      result[key] = { value: null, quality: 'OUT_OF_RANGE' };
    } else if (input.quality === 'missing') {
      result[key] = { value: null, quality: 'MISSING' };
    } else {
      result[key] = { value: null, quality: 'SENSOR_ERROR' };
    }
  }

  return result as NormalizedSensors;
}
