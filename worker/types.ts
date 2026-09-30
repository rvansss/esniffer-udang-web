/**
 * Definisi tipe dan interface untuk pipeline worker telemetry
 * Sesuai docs/esniffer/03-technical-design.md Section 5 & Section 6
 */

import {
  type ApplicationAck,
  type AckStatus,
  type AckRejectReason,
  type MeasurementTimeQuality,
  type NormalizedSensors,
  type TimeReference,
} from '../shared/types.ts';
import { type StoredAnchor } from '../shared/time.ts';

export interface StoredTimeReference extends StoredAnchor {
  timeReferenceId: string;
}

export interface CommittedReadingLookup {
  readingId: string;
  payloadSha256: string;
  deviceId: string;
  messageId: string;
  measuredAt: Date | null;
  chamberId: string | null;
}

export interface DeviceMetadataLookup {
  id: string;
  mqttDeviceId: string;
  isActive: boolean;
}

export interface AssignmentLookup {
  assignmentId: string;
  chamberId: string;
  activeFrom: Date;
  activeUntil: Date | null;
}

export interface TelemetryStoragePort {
  findCommittedReading(deviceId: string, messageId: string): Promise<CommittedReadingLookup | null>;
  findDevice(mqttDeviceId: string): Promise<DeviceMetadataLookup | null>;
  findAssignment(deviceId: string, measuredAt: Date): Promise<AssignmentLookup | null>;
  findTimeReference(deviceId: string, bootId: string): Promise<StoredTimeReference | null>;
  upsertTimeReference(
    deviceId: string,
    bootId: string,
    reference: TimeReference,
    receivedAt: Date
  ): Promise<string>;
  insertReading(record: NewReadingRecord): Promise<{ readingId: string }>;
}

export interface NewReadingRecord {
  deviceId: string;
  chamberId: string | null;
  assignmentId: string | null;
  messageId: string;
  payloadSha256: string;
  bootId: string;
  sequence: number;
  sampleUptimeMs: number;
  measuredAt: Date | null;
  receivedAt: Date;
  measurementTimeQuality: MeasurementTimeQuality;
  timeReferenceId: string | null;
  timeUncertaintyMs: number | null;
  sensors: NormalizedSensors;
  rawPayload: unknown;
}

export interface PipelineOutcome {
  status: AckStatus;
  ack: ApplicationAck;
  reasonCode?: AckRejectReason;
  readingId?: string;
  durationMs: number;
}
