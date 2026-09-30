/**
 * Prisma Implementation of TelemetryStoragePort & Application Persistence
 * Mengimplementasikan:
 * - Single transaction untuk watermark lock, sequence allocation, dan reading insertion
 * - Lookup committed reading untuk idempotensi
 * - Lookup device, assignment, dan time reference
 * - Status event recording (live vs retained evidence)
 * - Promosi unknown reading dalam satu transaksi atomik
 */

import { prisma, allocateHistorySequence } from '../lib/db/client.ts';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  type TelemetryStoragePort,
  type CommittedReadingLookup,
  type DeviceMetadataLookup,
  type AssignmentLookup,
  type NewReadingRecord,
  type StoredTimeReference,
} from './types.ts';
import { type StatusPayloadInput, type TimeReference } from '../shared/types.ts';

function toDbQuality(quality: string): 'OK' | 'SENSOR_ERROR' | 'OUT_OF_RANGE' | 'MISSING' {
  switch (quality.toLowerCase()) {
    case 'ok':
      return 'OK';
    case 'sensor_error':
      return 'SENSOR_ERROR';
    case 'out_of_range':
      return 'OUT_OF_RANGE';
    case 'missing':
      return 'MISSING';
    default:
      return 'SENSOR_ERROR';
  }
}

export class PrismaTelemetryStorage implements TelemetryStoragePort {
  private client: PrismaClient;

  constructor(client: PrismaClient = prisma) {
    this.client = client;
  }

  async checkHealth(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async findCommittedReading(
    deviceIdOrMqttId: string,
    messageId: string
  ): Promise<CommittedReadingLookup | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceIdOrMqttId);
    const reading = await this.client.sensorReading.findFirst({
      where: {
        messageId,
        OR: [
          { device: { mqttDeviceId: deviceIdOrMqttId } },
          ...(isUuid ? [{ deviceId: deviceIdOrMqttId }] : []),
        ],
      },
      select: {
        id: true,
        payloadSha256: true,
        deviceId: true,
        messageId: true,
        measuredAt: true,
        chamberId: true,
      },
    });

    if (!reading) return null;

    return {
      readingId: reading.id,
      payloadSha256: reading.payloadSha256,
      deviceId: reading.deviceId,
      messageId: reading.messageId,
      measuredAt: reading.measuredAt,
      chamberId: reading.chamberId,
    };
  }

  async findDevice(mqttDeviceId: string): Promise<DeviceMetadataLookup | null> {
    const dev = await this.client.device.findUnique({
      where: { mqttDeviceId },
      select: {
        id: true,
        mqttDeviceId: true,
        isActive: true,
      },
    });

    if (!dev) return null;

    return {
      id: dev.id,
      mqttDeviceId: dev.mqttDeviceId,
      isActive: dev.isActive,
    };
  }

  async findAssignment(
    deviceId: string,
    measuredAt: Date
  ): Promise<AssignmentLookup | null> {
    const assignment = await this.client.deviceAssignment.findFirst({
      where: {
        deviceId,
        activeFrom: { lte: measuredAt },
        OR: [
          { activeUntil: null },
          { activeUntil: { gt: measuredAt } },
        ],
      },
      orderBy: { activeFrom: 'desc' },
    });

    if (!assignment) return null;

    return {
      assignmentId: assignment.id,
      chamberId: assignment.chamberId,
      activeFrom: assignment.activeFrom,
      activeUntil: assignment.activeUntil,
    };
  }

  async findTimeReference(
    deviceId: string,
    bootId: string
  ): Promise<StoredTimeReference | null> {
    const ref = await this.client.deviceTimeReference.findFirst({
      where: { deviceId, bootId },
      orderBy: { receivedAt: 'desc' },
    });

    if (!ref) return null;

    return {
      timeReferenceId: ref.id,
      reference_id: ref.referenceKey,
      anchor_utc: ref.anchorUtc.toISOString(),
      anchor_uptime_ms: Number(ref.anchorUptimeMs),
      uncertainty_ms: ref.uncertaintyMs,
      source: ref.source,
      boot_id: ref.bootId,
    };
  }

  async upsertTimeReference(
    deviceId: string,
    bootId: string,
    reference: TimeReference,
    receivedAt: Date
  ): Promise<string> {
    const stored = await this.client.deviceTimeReference.upsert({
      where: {
        deviceId_bootId_referenceKey: {
          deviceId,
          bootId,
          referenceKey: reference.reference_id,
        },
      },
      update: {
        anchorUtc: new Date(reference.anchor_utc),
        anchorUptimeMs: BigInt(reference.anchor_uptime_ms),
        uncertaintyMs: reference.uncertainty_ms,
        source: reference.source,
        receivedAt,
      },
      create: {
        deviceId,
        bootId,
        referenceKey: reference.reference_id,
        anchorUtc: new Date(reference.anchor_utc),
        anchorUptimeMs: BigInt(reference.anchor_uptime_ms),
        uncertaintyMs: reference.uncertainty_ms,
        source: reference.source,
        receivedAt,
      },
    });

    return stored.id;
  }

  /**
   * Menyimpan reading baru ke database dalam SATU transaksi atomik:
   * 1. Alokasi history sequence dengan row-level lock pada watermark (hanya jika waktu diketahui)
   * 2. Insert record sensor reading
   * Jika transaksi rollback, sequence tidak terkonsumsi dan reading tidak tersimpan.
   */
  async insertReading(record: NewReadingRecord): Promise<{ readingId: string }> {
    return await this.client.$transaction(async (tx) => {
      let historySequence: bigint | null = null;

      // Poin 1: Lock watermark dan alokasi history_sequence di dalam transaksi yang sama
      if (record.measurementTimeQuality !== 'UNKNOWN') {
        historySequence = await allocateHistorySequence(tx);
      }

      const created = await tx.sensorReading.create({
        data: {
          deviceId: record.deviceId,
          chamberId: record.chamberId,
          assignmentId: record.assignmentId,
          messageId: record.messageId,
          payloadSha256: record.payloadSha256,
          bootId: record.bootId,
          sequence: BigInt(record.sequence),
          sampleUptimeMs: record.sampleUptimeMs != null ? BigInt(record.sampleUptimeMs) : null,
          measuredAt: record.measuredAt,
          receivedAt: record.receivedAt,
          measurementTimeQuality: record.measurementTimeQuality,
          timeReferenceId: record.timeReferenceId,
          timeUncertaintyMs: record.timeUncertaintyMs,
          historySequence,
          temperatureQuality: toDbQuality(record.sensors.temperature_c.quality),
          temperatureC: record.sensors.temperature_c.value != null ? new Prisma.Decimal(record.sensors.temperature_c.value) : null,
          humidityQuality: toDbQuality(record.sensors.humidity_percent.quality),
          humidityPercent: record.sensors.humidity_percent.value != null ? new Prisma.Decimal(record.sensors.humidity_percent.value) : null,
          mq137Quality: toDbQuality(record.sensors.mq137_raw.quality),
          mq137Raw: record.sensors.mq137_raw.value != null ? new Prisma.Decimal(record.sensors.mq137_raw.value) : null,
          mq136Quality: toDbQuality(record.sensors.mq136_raw.quality),
          mq136Raw: record.sensors.mq136_raw.value != null ? new Prisma.Decimal(record.sensors.mq136_raw.value) : null,
          mq4Quality: toDbQuality(record.sensors.mq4_raw.quality),
          mq4Raw: record.sensors.mq4_raw.value != null ? new Prisma.Decimal(record.sensors.mq4_raw.value) : null,
          rawPayload: record.rawPayload as Prisma.InputJsonValue,
        },
      });

      return { readingId: created.id };
    });
  }

  /**
   * Menyimpan event status dan memperbarui metadata koneksi perangkat.
   * Mengikuti aturan T-STS-02:
   * - isRetained = true: evidence = RETAINED_SNAPSHOT, state = UNKNOWN (bila online), last_seen_at TIDAK maju.
   * - isRetained = false: traffic live, last_seen_at maju.
   */
  async recordStatusEvent(
    status: StatusPayloadInput,
    isRetained: boolean,
    receivedAt: Date = new Date()
  ): Promise<void> {
    const device = await this.client.device.findUnique({
      where: { mqttDeviceId: status.device_id },
    });
    if (!device) return;

    let targetState = status.state.toUpperCase() as 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
    let targetEvidence: 'NONE' | 'LIVE_STATUS' | 'LIVE_TELEMETRY' | 'RETAINED_SNAPSHOT' | 'LWT' = 'LIVE_STATUS';

    if (isRetained) {
      targetEvidence = 'RETAINED_SNAPSHOT';
      if (status.state === 'online') {
        targetState = 'UNKNOWN'; // Retained snapshot online bukan bukti koneksi live
      }
    } else if (status.event_type === 'will') {
      targetEvidence = 'LWT';
      targetState = 'OFFLINE';
    }

    const updateData: Prisma.DeviceUpdateInput = {
      lastStatusProcessedAt: receivedAt,
      currentBootId: status.boot_id,
      currentSessionId: status.session_id,
      currentConnectionSeq: BigInt(status.connection_sequence),
      currentStatusSequence: BigInt(status.status_sequence),
      connectionEvidence: targetEvidence,
      connectionState: targetState,
      firmwareVersion: status.firmware_version || device.firmwareVersion,
    };

    // last_seen_at hanya maju bila menerima traffic live
    if (!isRetained && status.state === 'online') {
      updateData.lastSeenAt = receivedAt;
      updateData.lastStatusEventAt = status.event_at ? new Date(status.event_at) : receivedAt;
    }

    await this.client.device.update({
      where: { id: device.id },
      data: updateData,
    });

    // Simpan anchor waktu bila ada
    if (status.time_reference) {
      await this.client.deviceTimeReference.upsert({
        where: {
          deviceId_bootId_referenceKey: {
            deviceId: device.id,
            bootId: status.boot_id,
            referenceKey: status.time_reference.reference_id,
          },
        },
        update: {
          anchorUtc: new Date(status.time_reference.anchor_utc),
          anchorUptimeMs: BigInt(status.time_reference.anchor_uptime_ms),
          uncertaintyMs: status.time_reference.uncertainty_ms,
          source: status.time_reference.source,
          receivedAt,
        },
        create: {
          deviceId: device.id,
          bootId: status.boot_id,
          referenceKey: status.time_reference.reference_id,
          anchorUtc: new Date(status.time_reference.anchor_utc),
          anchorUptimeMs: BigInt(status.time_reference.anchor_uptime_ms),
          uncertaintyMs: status.time_reference.uncertainty_ms,
          source: status.time_reference.source,
          receivedAt,
        },
      });
    }
  }

  /**
   * Mempromosikan data UNKNOWN menjadi RECONSTRUCTED dalam SATU transaksi atomik:
   * 1. Alokasi history sequence baru
   * 2. Update status, measuredAt, chamber, assignment, dan sequence
   */
  async promoteUnknownReading(
    readingId: string,
    params: {
      measuredAt: Date;
      chamberId: string;
      assignmentId: string;
      timeReferenceId: string;
      timeUncertaintyMs: number;
    }
  ): Promise<{ readingId: string; historySequence: bigint }> {
    return await this.client.$transaction(async (tx) => {
      const historySequence = await allocateHistorySequence(tx);
      const updated = await tx.sensorReading.update({
        where: { id: readingId },
        data: {
          measurementTimeQuality: 'RECONSTRUCTED',
          measuredAt: params.measuredAt,
          chamberId: params.chamberId,
          assignmentId: params.assignmentId,
          timeReferenceId: params.timeReferenceId,
          timeUncertaintyMs: params.timeUncertaintyMs,
          historySequence,
        },
      });
      return { readingId: updated.id, historySequence };
    });
  }
}
