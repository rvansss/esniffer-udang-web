/**
 * Kontrak domain bersama untuk e-Sniffer Udang Web (MQTT v1 & Ingestion)
 * Sesuai spesifikasi docs/esniffer/02-skpl.md dan docs/esniffer/03-technical-design.md
 */

export const SCHEMA_VERSION = 1 as const;
export const MAX_PAYLOAD_BYTES = 4096; // 4 KiB hard limit
export const MAX_DEVICE_ID_LENGTH = 64;

export type SensorQuality = 'OK' | 'SENSOR_ERROR' | 'OUT_OF_RANGE' | 'MISSING';
export type InputSensorQuality = 'ok' | 'sensor_error' | 'out_of_range' | 'missing';

export type MeasurementTimeQuality = 'SYNCED' | 'RECONSTRUCTED' | 'UNKNOWN';

export type ConnectionState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE';

export type ConnectionEvidence =
  | 'NONE'
  | 'LIVE_STATUS'
  | 'LIVE_TELEMETRY'
  | 'RETAINED_SNAPSHOT'
  | 'LWT';

export type IngestionSource = 'MQTT' | 'PROMETHEUS_IMPORT';

export type MqttMessageType = 'telemetry' | 'status' | 'ack';

export interface ParsedTopic {
  version: 'v1';
  deviceId: string;
  messageType: MqttMessageType;
  rawTopic: string;
}

export interface TimeReference {
  reference_id: string;
  anchor_utc: string; // RFC 3339 UTC
  anchor_uptime_ms: number; // unsigned integer
  uncertainty_ms: number; // millisecond uncertainty
  source: string;
}

export interface SensorReadingInput {
  value: number | null;
  quality: InputSensorQuality;
}

export interface TelemetrySensorsInput {
  temperature_c: SensorReadingInput;
  humidity_percent: SensorReadingInput;
  mq137_raw: SensorReadingInput;
  mq136_raw: SensorReadingInput;
  mq4_raw: SensorReadingInput;
}

export interface TelemetryPayloadInput {
  schema_version: 1;
  device_id: string;
  message_id: string; // boot_id:sequence
  boot_id: string; // UUID v4
  sequence: number; // Monotonic counter in boot
  sample_uptime_ms: number;
  measured_at: string | null; // RFC 3339 UTC or null if not clock_synced
  clock_synced: boolean;
  time_reference?: TimeReference | null;
  firmware_version?: string;
  sensors: TelemetrySensorsInput;
}

export interface NormalizedSensorValue {
  value: number | null;
  quality: SensorQuality;
}

export interface NormalizedSensors {
  temperature_c: NormalizedSensorValue;
  humidity_percent: NormalizedSensorValue;
  mq137_raw: NormalizedSensorValue;
  mq136_raw: NormalizedSensorValue;
  mq4_raw: NormalizedSensorValue;
}

export type StatusEventType = 'connect' | 'heartbeat' | 'will';
export type StatusState = 'online' | 'offline';

export interface DeviceQueueStats {
  depth: number;
  capacity: number;
  dropped_total: number;
}

export interface StatusPayloadInput {
  schema_version: 1;
  device_id: string;
  boot_id: string;
  session_id: string;
  connection_sequence: number;
  status_sequence: number;
  event_type: StatusEventType;
  state: StatusState;
  uptime_ms: number;
  event_at: string | null;
  clock_synced: boolean;
  firmware_version?: string;
  queue?: DeviceQueueStats;
  time_reference?: TimeReference;
}

export type AckStatus = 'accepted' | 'accepted_unresolved_time' | 'duplicate' | 'rejected';

export type AckRejectReason =
  | 'SCHEMA_INVALID'
  | 'DEVICE_UNKNOWN'
  | 'DEVICE_DISABLED'
  | 'MESSAGE_ID_CONFLICT'
  | 'ASSIGNMENT_NOT_FOUND'
  | 'TIMESTAMP_INVALID'
  | 'BACKLOG_EXPIRED'
  | 'TOPIC_MISMATCH'
  | 'PAYLOAD_TOO_LARGE';

export interface ApplicationAck {
  schema_version: 1;
  message_id: string;
  payload_sha256: string;
  status: AckStatus;
  reading_id?: string;
  received_at: string; // RFC 3339 UTC
  reason_code?: AckRejectReason;
}
