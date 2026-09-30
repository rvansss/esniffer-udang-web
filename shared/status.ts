/**
 * Validator payload status, heartbeat, dan Last Will (LWT) MQTT v1
 * Sesuai docs/esniffer/03-technical-design.md Section 6.4
 */

import {
  SCHEMA_VERSION,
  type StatusPayloadInput,
  type StatusEventType,
  type StatusState,
  type ConnectionState,
  type ConnectionEvidence,
} from './types.ts';
import { isValidDeviceId } from './topic.ts';
import { isValidUuid, isValidRfc3339 } from './telemetry-schema.ts';

export class StatusValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusValidationError';
  }
}

/**
 * Validasi ketat terhadap payload status perangkat
 */
export function validateStatusPayload(
  payload: unknown,
  topicDeviceId?: string
): StatusPayloadInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new StatusValidationError('Status payload must be a JSON object');
  }

  const p = payload as Record<string, unknown>;

  // 1. schema_version
  if (p.schema_version !== SCHEMA_VERSION) {
    throw new StatusValidationError(
      `Unsupported schema_version: ${p.schema_version}. Expected ${SCHEMA_VERSION}`
    );
  }

  // 2. device_id
  if (typeof p.device_id !== 'string' || !isValidDeviceId(p.device_id)) {
    throw new StatusValidationError(`Invalid device_id in status payload: "${p.device_id}"`);
  }

  if (topicDeviceId !== undefined && p.device_id !== topicDeviceId) {
    throw new StatusValidationError(
      `Topic device_id "${topicDeviceId}" does not match status payload device_id "${p.device_id}"`
    );
  }

  // 3. boot_id & session_id
  if (!isValidUuid(p.boot_id)) {
    throw new StatusValidationError(`Invalid boot_id: "${p.boot_id}"`);
  }
  if (!isValidUuid(p.session_id)) {
    throw new StatusValidationError(`Invalid session_id: "${p.session_id}"`);
  }

  // 4. connection_sequence & status_sequence
  if (
    typeof p.connection_sequence !== 'number' ||
    !Number.isSafeInteger(p.connection_sequence) ||
    p.connection_sequence < 1
  ) {
    throw new StatusValidationError(
      `Invalid connection_sequence: ${p.connection_sequence}. Must be an integer >= 1`
    );
  }

  if (
    typeof p.status_sequence !== 'number' ||
    !Number.isSafeInteger(p.status_sequence) ||
    p.status_sequence < 1
  ) {
    throw new StatusValidationError(
      `Invalid status_sequence: ${p.status_sequence}. Must be an integer >= 1`
    );
  }

  // 5. event_type & state
  const validEvents: StatusEventType[] = ['connect', 'heartbeat', 'will'];
  if (typeof p.event_type !== 'string' || !validEvents.includes(p.event_type as StatusEventType)) {
    throw new StatusValidationError(`Invalid event_type: "${p.event_type}"`);
  }

  const validStates: StatusState[] = ['online', 'offline'];
  if (typeof p.state !== 'string' || !validStates.includes(p.state as StatusState)) {
    throw new StatusValidationError(`Invalid state: "${p.state}"`);
  }

  // Will harus berpasangan dengan offline
  if (p.event_type === 'will' && p.state !== 'offline') {
    throw new StatusValidationError('event_type "will" must have state "offline"');
  }

  // 6. uptime_ms
  if (
    typeof p.uptime_ms !== 'number' ||
    !Number.isSafeInteger(p.uptime_ms) ||
    p.uptime_ms < 0
  ) {
    throw new StatusValidationError(`Invalid uptime_ms: ${p.uptime_ms}`);
  }

  // 7. clock_synced & event_at
  if (typeof p.clock_synced !== 'boolean') {
    throw new StatusValidationError('clock_synced must be a boolean');
  }

  if (p.event_at !== null && !isValidRfc3339(p.event_at)) {
    throw new StatusValidationError(`event_at must be an RFC 3339 timestamp or null: "${p.event_at}"`);
  }

  // 8. queue (opsional)
  if (p.queue !== undefined && p.queue !== null) {
    if (typeof p.queue !== 'object' || Array.isArray(p.queue)) {
      throw new StatusValidationError('queue must be an object or null');
    }
    const q = p.queue as Record<string, unknown>;
    if (
      typeof q.depth !== 'number' ||
      typeof q.capacity !== 'number' ||
      typeof q.dropped_total !== 'number'
    ) {
      throw new StatusValidationError('queue must contain depth, capacity, and dropped_total as numbers');
    }
  }

  return payload as StatusPayloadInput;
}

export interface ConnectionStateTransition {
  newState: ConnectionState;
  newEvidence: ConnectionEvidence;
  shouldUpdateLastSeen: boolean;
}

/**
 * Logika evaluasi status koneksi berdasarkan flag retain MQTT dan jenis event.
 * Sesuai Section 6.4: Retained online saat startup worker BUKAN bukti live traffic.
 */
export function evaluateConnectionStatus(
  status: StatusPayloadInput,
  isRetained: boolean
): ConnectionStateTransition {
  if (isRetained) {
    // Replay paket retained dari broker
    if (status.state === 'online') {
      return {
        newState: 'UNKNOWN',
        newEvidence: 'RETAINED_SNAPSHOT',
        shouldUpdateLastSeen: false, // JANGAN majukan last_seen_at pada retained replay
      };
    } else {
      return {
        newState: 'OFFLINE',
        newEvidence: 'RETAINED_SNAPSHOT',
        shouldUpdateLastSeen: false,
      };
    }
  }

  // Live traffic (bukan retained)
  if (status.event_type === 'will') {
    return {
      newState: 'OFFLINE',
      newEvidence: 'LWT',
      shouldUpdateLastSeen: false,
    };
  }

  return {
    newState: status.state === 'online' ? 'ONLINE' : 'OFFLINE',
    newEvidence: 'LIVE_STATUS',
    shouldUpdateLastSeen: true,
  };
}
