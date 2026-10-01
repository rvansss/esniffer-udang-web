/**
 * Pengujian unit pipeline worker e-Sniffer (skeleton tanpa koneksi aktif)
 * Menguji skenario T-ING-01, T-ING-02, T-ING-03, T-ING-04, T-ING-05, T-ING-07, T-ING-08, T-ING-09
 * Sesuai KF-ING-001, KF-ING-002, KF-ING-003, KF-ING-004, dan docs/esniffer/04-implementation-plan.md
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processTelemetryMessage } from '../worker/pipeline.ts';
import {
  type TelemetryStoragePort,
  type CommittedReadingLookup,
  type DeviceMetadataLookup,
  type AssignmentLookup,
  type NewReadingRecord,
  type StoredTimeReference,
} from '../worker/types.ts';
import type { TimeReference } from '../shared/types.ts';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadRawFixture(filename: string): string {
  return readFileSync(join(fixturesDir, filename), 'utf8');
}

/**
 * Mock storage in-memory untuk pengujian deterministik pipeline worker
 */
class MockStorage implements TelemetryStoragePort {
  public committedReadings = new Map<string, CommittedReadingLookup>();
  public devices = new Map<string, DeviceMetadataLookup>();
  public assignments: AssignmentLookup[] = [];
  public timeReferences: StoredTimeReference[] = [];
  public insertedRecords: NewReadingRecord[] = [];

  async findCommittedReading(deviceId: string, messageId: string): Promise<CommittedReadingLookup | null> {
    return this.committedReadings.get(`${deviceId}:${messageId}`) ?? null;
  }

  async findDevice(mqttDeviceId: string): Promise<DeviceMetadataLookup | null> {
    return this.devices.get(mqttDeviceId) ?? null;
  }

  async findAssignment(deviceId: string, measuredAt: Date): Promise<AssignmentLookup | null> {
    const time = measuredAt.getTime();
    for (const a of this.assignments) {
      const from = a.activeFrom.getTime();
      const until = a.activeUntil ? a.activeUntil.getTime() : Infinity;
      if (time >= from && time < until) {
        return a;
      }
    }
    return null;
  }

  async findTimeReference(deviceId: string, bootId: string): Promise<StoredTimeReference | null> {
    return this.timeReferences.find((r) => r.boot_id === bootId) ?? null;
  }

  async upsertTimeReference(
    deviceId: string,
    bootId: string,
    reference: TimeReference,
    receivedAt: Date
  ): Promise<string> {
    void receivedAt;
    const timeReferenceId = `time-reference-${this.timeReferences.length + 1}`;
    this.timeReferences.push({
      ...reference,
      boot_id: bootId,
      timeReferenceId,
    });
    return timeReferenceId;
  }

  async insertReading(record: NewReadingRecord): Promise<{ readingId: string }> {
    const readingId = `reading-uuid-${this.insertedRecords.length + 1}`;
    this.insertedRecords.push(record);
    this.committedReadings.set(`${record.deviceId}:${record.messageId}`, {
      readingId,
      payloadSha256: record.payloadSha256,
      deviceId: record.deviceId,
      messageId: record.messageId,
      measuredAt: record.measuredAt,
      chamberId: record.chamberId,
    });
    return { readingId };
  }
}

function createSetupStorage(): MockStorage {
  const storage = new MockStorage();
  // Daftarkan device default
  storage.devices.set('esp32-001', {
    id: 'esp32-001',
    mqttDeviceId: 'esp32-001',
    isActive: true,
  });

  // Daftarkan assignment ke chamber 1
  storage.assignments.push({
    assignmentId: 'assign-1',
    chamberId: 'chamber-1',
    activeFrom: new Date('2026-09-01T00:00:00.000Z'),
    activeUntil: null, // aktif tanpa batas
  });

  return storage;
}

test('T-ING-01: Paket telemetry valid diproses menghasilkan status accepted dan ACK valid', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('valid-telemetry.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  const result = await processTelemetryMessage(
    topic,
    rawPayload,
    storage,
    new Date('2026-09-30T07:15:35.000Z')
  );

  assert.strictEqual(result.status, 'accepted');
  assert.strictEqual(result.ack.status, 'accepted');
  assert.strictEqual(result.ack.message_id, '550e8400-e29b-41d4-a716-446655440000:0000000042');
  assert.ok(result.readingId);
  assert.strictEqual(storage.insertedRecords.length, 1);
  assert.strictEqual(storage.insertedRecords[0].chamberId, 'chamber-1');
});

test('T-ING-02: Paket dengan error struktur ditolak permanen dengan reason code', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('invalid-structural-type.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  const result = await processTelemetryMessage(topic, rawPayload, storage);

  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.ack.status, 'rejected');
  assert.strictEqual(result.reasonCode, 'SCHEMA_INVALID');
  assert.strictEqual(storage.insertedRecords.length, 0);
});

test('T-ING-04: Perangkat tidak terdaftar ditolak dengan DEVICE_UNKNOWN', async () => {
  const storage = new MockStorage(); // Tidak ada device terdaftar
  const rawPayload = loadRawFixture('valid-telemetry.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  const result = await processTelemetryMessage(topic, rawPayload, storage);

  assert.strictEqual(result.status, 'rejected');
  assert.strictEqual(result.reasonCode, 'DEVICE_UNKNOWN');
  assert.strictEqual(storage.insertedRecords.length, 0);
});

test('T-ING-05: Tiga pesan identik berturut-turut menghasilkan 1 accepted dan 2 duplicate', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('valid-telemetry.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';
  const receivedAt = new Date('2026-09-30T07:15:35.000Z');

  // Pengiriman 1
  const res1 = await processTelemetryMessage(topic, rawPayload, storage, receivedAt);
  assert.strictEqual(res1.status, 'accepted');
  const readingId = res1.readingId;

  // Pengiriman 2 (retry identik)
  const res2 = await processTelemetryMessage(topic, rawPayload, storage, receivedAt);
  assert.strictEqual(res2.status, 'duplicate');
  assert.strictEqual(res2.ack.status, 'duplicate');
  assert.strictEqual(res2.readingId, readingId);

  // Pengiriman 3 (retry identik)
  const res3 = await processTelemetryMessage(topic, rawPayload, storage, receivedAt);
  assert.strictEqual(res3.status, 'duplicate');
  assert.strictEqual(res3.readingId, readingId);

  // Pastikan tepat 1 row tersimpan di database
  assert.strictEqual(storage.insertedRecords.length, 1);
});

test('T-ING-07: Message ID sama dengan isi berbeda ditolak sebagai MESSAGE_ID_CONFLICT', async () => {
  const storage = createSetupStorage();
  const validPayload = loadRawFixture('valid-telemetry.json');
  const conflictPayload = loadRawFixture('id-conflict.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  // Simpan pesan pertama
  const res1 = await processTelemetryMessage(topic, validPayload, storage);
  assert.strictEqual(res1.status, 'accepted');

  // Kirim payload berbeda dengan message_id sama
  const resConflict = await processTelemetryMessage(topic, conflictPayload, storage);
  assert.strictEqual(resConflict.status, 'rejected');
  assert.strictEqual(resConflict.reasonCode, 'MESSAGE_ID_CONFLICT');

  // Pastikan database tidak ditimpa/diubah
  assert.strictEqual(storage.insertedRecords.length, 1);
});

test('T-ING-08 & T-ING-09: Retry committed tetap memperoleh duplicate saat device dinonaktifkan', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('valid-telemetry.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  // 1. Pesan awal commit sukses
  const res1 = await processTelemetryMessage(topic, rawPayload, storage);
  assert.strictEqual(res1.status, 'accepted');

  // 2. Sekarang nonaktifkan perangkat
  storage.devices.get('esp32-001')!.isActive = false;

  // 3. Retry pesan yang sudah committed
  // Sesuai KF-ING-003: dedupe lookup mendahului status device, sehingga duplicate berhasil
  const resRetry = await processTelemetryMessage(topic, rawPayload, storage);
  assert.strictEqual(resRetry.status, 'duplicate');
  assert.strictEqual(resRetry.readingId, res1.readingId);
});

test('Data unknown-time menghasilkan accepted_unresolved_time dengan chamberId=null', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('backlog-unknown-time.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  const result = await processTelemetryMessage(topic, rawPayload, storage);

  assert.strictEqual(result.status, 'accepted_unresolved_time');
  assert.strictEqual(result.ack.status, 'accepted_unresolved_time');
  assert.strictEqual(storage.insertedRecords.length, 1);
  assert.strictEqual(storage.insertedRecords[0].chamberId, null);
  assert.strictEqual(storage.insertedRecords[0].assignmentId, null);
  assert.strictEqual(storage.insertedRecords[0].measuredAt, null);
});

test('Backlog dengan time anchor tersimpan sebagai RECONSTRUCTED dan memakai ID row reference', async () => {
  const storage = createSetupStorage();
  const rawPayload = loadRawFixture('backlog-reconstructed.json');
  const topic = 'esniffer/v1/devices/esp32-001/telemetry';

  const result = await processTelemetryMessage(
    topic,
    rawPayload,
    storage,
    new Date('2026-09-30T07:15:35.000Z')
  );

  assert.strictEqual(result.status, 'accepted');
  assert.strictEqual(storage.insertedRecords.length, 1);
  assert.strictEqual(storage.insertedRecords[0].measurementTimeQuality, 'RECONSTRUCTED');
  assert.strictEqual(storage.insertedRecords[0].timeReferenceId, 'time-reference-1');
  assert.strictEqual(storage.timeReferences[0].reference_id, 'ntp-550e8400-1');
});
