/**
 * Pipeline pemrosesan paket telemetry pada Worker e-Sniffer
 * Mengimplementasikan alur:
 * 1. Byte limit
 * 2. Strict parse & topic identity check
 * 3. Canonical RFC 8785 hash (immutable)
 * 4. Dedupe lookup (same hash -> duplicate; diff hash -> MESSAGE_ID_CONFLICT)
 * 5. Full schema & device active check
 * 6. Sensor normalization (out-of-range -> null + OUT_OF_RANGE; sensor_error -> null + SENSOR_ERROR)
 * 7. Time evaluation (synced, anchor same-boot, unknown-time)
 * 8. Assignment lookup & atomik insertion
 * 9. Application ACK generation
 *
 * Sesuai KF-ING-001, KF-ING-002, KF-ING-003, KF-ING-004, dan docs/esniffer/03-technical-design.md Section 5.5
 */

import { parseTopic, TopicValidationError } from '../shared/topic.ts';
import { processCanonicalPayload, CanonicalizationError } from '../shared/canonical.ts';
import {
  validateTelemetryPayload,
  normalizeSensors,
  TelemetryValidationError,
} from '../shared/telemetry-schema.ts';
import { evaluateTelemetryTime, TimeValidationError } from '../shared/time.ts';
import {
  type ApplicationAck,
  type AckRejectReason,
  SCHEMA_VERSION,
  type TelemetryPayloadInput,
} from '../shared/types.ts';
import { type TelemetryStoragePort, type PipelineOutcome } from './types.ts';
import { runWithLogContext } from '../lib/logging/context.ts';
import { logger } from '../lib/logging/logger.ts';
import { randomUUID } from 'node:crypto';

export async function processTelemetryMessage(
  topicStr: string,
  rawPayload: string | Buffer,
  storage: TelemetryStoragePort,
  receivedAt: Date = new Date(),
  correlationId: string = randomUUID()
): Promise<PipelineOutcome> {
  const startTime = Date.now();

  return runWithLogContext({ correlationId, service: 'worker' }, async () => {
    let parsedTopicDeviceId = '';
    let messageId = 'unknown';
    let payloadSha256 = '';

    const createRejectAck = (reasonCode: AckRejectReason): PipelineOutcome => {
      const durationMs = Date.now() - startTime;
      const ack: ApplicationAck = {
        schema_version: SCHEMA_VERSION,
        message_id: messageId,
        payload_sha256: payloadSha256,
        status: 'rejected',
        received_at: receivedAt.toISOString(),
        reason_code: reasonCode,
      };

      logger.warn({
        operation: 'process_telemetry',
        outcome: 'rejected',
        reason_code: reasonCode,
        device_id: parsedTopicDeviceId,
        message_id: messageId,
        duration_ms: durationMs,
      });

      return {
        status: 'rejected',
        ack,
        reasonCode,
        durationMs,
      };
    };

    // 1. Validasi topic
    try {
      const parsedTopic = parseTopic(topicStr);
      if (parsedTopic.messageType !== 'telemetry') {
        return createRejectAck('TOPIC_MISMATCH');
      }
      parsedTopicDeviceId = parsedTopic.deviceId;
    } catch (err) {
      if (err instanceof TopicValidationError) {
        return createRejectAck('TOPIC_MISMATCH');
      }
      return createRejectAck('SCHEMA_INVALID');
    }

    // 2. Canonicalization, duplicate key check, dan SHA-256 payload hash
    // Sesuai Review Note 3: Hash dihitung atas payload asli sebelum ada normalisasi
    let canonicalJson = '';
    try {
      const canonicalResult = processCanonicalPayload(rawPayload);
      canonicalJson = canonicalResult.canonicalJson;
      payloadSha256 = canonicalResult.payloadSha256;
    } catch (err) {
      if (err instanceof CanonicalizationError) {
        if (err.message.includes('exceeds maximum')) {
          return createRejectAck('PAYLOAD_TOO_LARGE');
        }
        return createRejectAck('SCHEMA_INVALID');
      }
      return createRejectAck('SCHEMA_INVALID');
    }

    // 3. Parse JSON untuk memeriksa minimal envelope identity
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(canonicalJson);
    } catch {
      return createRejectAck('SCHEMA_INVALID');
    }

    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      return createRejectAck('SCHEMA_INVALID');
    }

    const envelope = parsedJson as Record<string, unknown>;
    const payloadDeviceId = String(envelope.device_id || '');
    messageId = String(envelope.message_id || '');

    // Cocokkan topic device_id dengan payload device_id
    if (parsedTopicDeviceId !== payloadDeviceId) {
      return createRejectAck('TOPIC_MISMATCH');
    }

    // 4. Lookup committed record untuk idempotensi (KF-ING-003)
    // Sesuai ADR-005: lookup committed dilakukan SEBELUM validasi device active/assignment/backlog
    try {
      const committed = await storage.findCommittedReading(payloadDeviceId, messageId);
      if (committed) {
        if (committed.payloadSha256 === payloadSha256) {
          // Idempotent duplicate: key dan hash sama persis
          const durationMs = Date.now() - startTime;
          const ack: ApplicationAck = {
            schema_version: SCHEMA_VERSION,
            message_id: messageId,
            payload_sha256: payloadSha256,
            status: 'duplicate',
            reading_id: committed.readingId,
            received_at: receivedAt.toISOString(),
          };

          logger.debug({
            operation: 'process_telemetry',
            outcome: 'duplicate',
            device_id: payloadDeviceId,
            message_id: messageId,
            reading_id: committed.readingId,
            duration_ms: durationMs,
          });

          return {
            status: 'duplicate',
            ack,
            readingId: committed.readingId,
            durationMs,
          };
        } else {
          // Message ID conflict: ID sama tetapi isi canonical berbeda
          logger.warn({
            operation: 'process_telemetry',
            outcome: 'conflict',
            reason_code: 'MESSAGE_ID_CONFLICT',
            device_id: payloadDeviceId,
            message_id: messageId,
            duration_ms: Date.now() - startTime,
          });
          return createRejectAck('MESSAGE_ID_CONFLICT');
        }
      }
    } catch (err) {
      // Storage lookup failure
      logger.error({
        operation: 'process_telemetry',
        outcome: 'storage_error',
        device_id: payloadDeviceId,
        message_id: messageId,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // 5. Validasi penuh skema telemetry (KF-ING-002, T-ING-02)
    let validatedPayload: TelemetryPayloadInput;
    try {
      validatedPayload = validateTelemetryPayload(parsedJson, parsedTopicDeviceId);
    } catch (err) {
      if (err instanceof TelemetryValidationError) {
        return createRejectAck(err.reasonCode);
      }
      return createRejectAck('SCHEMA_INVALID');
    }

    // 6. Validasi status perangkat aktif (KF-ING-001 / KF-API-001)
    const device = await storage.findDevice(validatedPayload.device_id);
    if (!device) {
      return createRejectAck('DEVICE_UNKNOWN');
    }
    if (!device.isActive) {
      return createRejectAck('DEVICE_DISABLED');
    }

    // 7. Normalisasi nilai sensor (T-ING-03)
    const normalizedSensors = normalizeSensors(validatedPayload.sensors);

    // 8. Evaluasi timestamp (KF-ING-004, Review Note 2)
    let storedAnchor = null;
    if (!validatedPayload.clock_synced && !validatedPayload.time_reference) {
      // Coba cari anchor waktu yang sudah tersimpan untuk boot_id ini
      storedAnchor = await storage.findTimeReference(device.id, validatedPayload.boot_id);
    }

    let timeResult;
    try {
      timeResult = evaluateTelemetryTime(validatedPayload, receivedAt, storedAnchor);
    } catch (err) {
      if (err instanceof TimeValidationError) {
        return createRejectAck(err.reasonCode);
      }
      return createRejectAck('TIMESTAMP_INVALID');
    }

    // 9. Penentuan Chamber Assignment
    let resolvedChamberId: string | null = null;
    let resolvedAssignmentId: string | null = null;

    if (timeResult.quality !== 'UNKNOWN' && timeResult.measuredAt !== null) {
      // Waktu pengukuran diketahui (SYNCED atau RECONSTRUCTED):
      // Wajib mencari assignment historis pada saat measured_at
      const assignment = await storage.findAssignment(device.id, timeResult.measuredAt);
      if (!assignment) {
        return createRejectAck('ASSIGNMENT_NOT_FOUND');
      }
      resolvedChamberId = assignment.chamberId;
      resolvedAssignmentId = assignment.assignmentId;
    } else {
      // Unknown-time reading (Review Note 2):
      // Disimpan device-scoped, chamber dan assignment adalah null!
      resolvedChamberId = null;
      resolvedAssignmentId = null;
    }

    // Resolve the domain reference key to the database row UUID. A telemetry
    // payload may carry a new anchor itself, while an older buffered sample may
    // use an anchor previously persisted from a status heartbeat.
    let resolvedTimeReferenceId: string | null = null;
    if (timeResult.referenceKey) {
      if (validatedPayload.time_reference) {
        resolvedTimeReferenceId = await storage.upsertTimeReference(
          device.id,
          validatedPayload.boot_id,
          validatedPayload.time_reference,
          receivedAt
        );
      } else if (storedAnchor?.reference_id === timeResult.referenceKey) {
        resolvedTimeReferenceId = storedAnchor.timeReferenceId;
      }
    }

    if (timeResult.quality === 'RECONSTRUCTED' && !resolvedTimeReferenceId) {
      throw new Error('Reconstructed reading is missing a persisted time reference');
    }

    // 10. Persistensi atomik ke database
    const newRecord = {
      deviceId: device.id,
      chamberId: resolvedChamberId,
      assignmentId: resolvedAssignmentId,
      messageId: validatedPayload.message_id,
      payloadSha256,
      bootId: validatedPayload.boot_id,
      sequence: validatedPayload.sequence,
      sampleUptimeMs: validatedPayload.sample_uptime_ms,
      measuredAt: timeResult.measuredAt,
      receivedAt,
      measurementTimeQuality: timeResult.quality,
      timeReferenceId: resolvedTimeReferenceId,
      timeUncertaintyMs: timeResult.uncertaintyMs,
      sensors: normalizedSensors,
      rawPayload: parsedJson,
    };

    const inserted = await storage.insertReading(newRecord);
    const durationMs = Date.now() - startTime;

    const outcomeStatus: 'accepted' | 'accepted_unresolved_time' =
      timeResult.quality === 'UNKNOWN' ? 'accepted_unresolved_time' : 'accepted';

    const ack: ApplicationAck = {
      schema_version: SCHEMA_VERSION,
      message_id: messageId,
      payload_sha256: payloadSha256,
      status: outcomeStatus,
      reading_id: inserted.readingId,
      received_at: receivedAt.toISOString(),
    };

    logger.debug({
      operation: 'process_telemetry',
      outcome: outcomeStatus,
      device_id: payloadDeviceId,
      message_id: messageId,
      reading_id: inserted.readingId,
      duration_ms: durationMs,
    });

    return {
      status: outcomeStatus,
      ack,
      readingId: inserted.readingId,
      durationMs,
    };
  });
}
