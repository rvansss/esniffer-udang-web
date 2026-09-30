/**
 * End-to-End Integration Tests: Mosquitto & Worker Ingestion
 * Menguji 9 skenario end-to-end minimum sesuai spesifikasi:
 * 1. Telemetry valid tersimpan dan mendapat ACK (accepted)
 * 2. Retry identik tidak menggandakan reading (duplicate ACK)
 * 3. ID sama dengan payload berbeda ditolak (MESSAGE_ID_CONFLICT)
 * 4. DB mati tidak menghasilkan ACK berhasil, lalu retry pulih
 * 5. Worker restart resilience
 * 6. Retained online tidak dianggap traffic live (RETAINED_SNAPSHOT vs LIVE)
 * 7. Perangkat tidak dapat mengakses topik perangkat lain (ACL test)
 * 8. Unresolved-time tetap tersimpan dan dapat ditemukan
 * 9. Publish ACK gagal setelah commit, kemudian retry mendapat duplicate
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { WorkerDaemon } from '../../worker/index.ts';
import { DeviceSimulator } from './simulator.ts';
import { PrismaTelemetryStorage } from '../../worker/storage.ts';
import { type StatusPayloadInput } from '../../shared/types.ts';

const MQTT_URL = 'mqtt://127.0.0.1:1883';

async function isBrokerAvailable(port = 1883, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

describe('MQTT Ingestion & Mosquitto End-to-End Tests', async () => {
  let brokerUp = false;
  let worker: WorkerDaemon | null = null;
  let simulator: DeviceSimulator | null = null;
  let simulator2: DeviceSimulator | null = null;
  let testChamberId: string;
  let testDeviceId: string;

  before(async () => {
    brokerUp = await isBrokerAvailable();
    if (!brokerUp) {
      console.warn('Broker Mosquitto tidak berjalan di 127.0.0.1:1883. Tests will be skipped.');
      return;
    }

    // Pastikan chamber dan devices terdaftar di database
    const ch = await prisma.chamber.upsert({
      where: { code: 'CH-01' },
      update: {},
      create: { code: 'CH-01', name: 'Chamber 1' },
    });
    testChamberId = ch.id;

    const dev = await prisma.device.upsert({
      where: { mqttDeviceId: 'esp32-001' },
      update: { isActive: true },
      create: { mqttDeviceId: 'esp32-001', name: 'Node 01', isActive: true },
    });
    testDeviceId = dev.id;

    await prisma.device.upsert({
      where: { mqttDeviceId: 'esp32-002' },
      update: { isActive: true },
      create: { mqttDeviceId: 'esp32-002', name: 'Node 02', isActive: true },
    });

    // Pastikan assignment aktif untuk esp32-001
    const asg = await prisma.deviceAssignment.findFirst({
      where: { deviceId: testDeviceId, activeUntil: null },
    });
    if (!asg) {
      await prisma.deviceAssignment.create({
        data: {
          deviceId: testDeviceId,
          chamberId: testChamberId,
          activeFrom: new Date('2026-09-01T00:00:00.000Z'),
          activeUntil: null,
        },
      });
    }

    // Inisialisasi dan jalankan WorkerDaemon
    worker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-e2e-${Date.now()}`,
      username: 'worker',
      password: 'workerpass123',
      concurrencyLimit: 5,
    });
    await worker.start();

    // Inisialisasi simulator perangkat esp32-001
    simulator = new DeviceSimulator({
      deviceId: 'esp32-001',
      password: 'devicepass001',
      mqttUrl: MQTT_URL,
    });
    await simulator.connect();

    // Inisialisasi simulator perangkat esp32-002
    simulator2 = new DeviceSimulator({
      deviceId: 'esp32-002',
      password: 'devicepass002',
      mqttUrl: MQTT_URL,
    });
    await simulator2.connect();
  });

  after(async () => {
    if (simulator) await simulator.disconnect();
    if (simulator2) await simulator2.disconnect();
    if (worker) await worker.stop();
    await closeDb();
  });

  it('1. Telemetry valid tersimpan di database dan menerima ACK accepted', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    const payload = simulator.createTelemetryPayload();
    await simulator.sendTelemetry(payload);

    const ack = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(ack.status, 'accepted');
    assert.strictEqual(ack.message_id, payload.message_id);
    assert.ok(ack.reading_id, 'Reading ID harus ada');
    assert.ok(ack.payload_sha256, 'Payload hash harus ada');

    // Verifikasi fisik di PostgreSQL
    const saved = await prisma.sensorReading.findUnique({
      where: { id: ack.reading_id },
    });
    assert.ok(saved);
    assert.strictEqual(saved.messageId, payload.message_id);
    assert.strictEqual(saved.measurementTimeQuality, 'SYNCED');
    assert.ok(saved.historySequence !== null, 'History sequence harus dialokasikan');
  });

  it('2. Retry identik tidak menggandakan reading dan menerima ACK duplicate', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    const payload = simulator.createTelemetryPayload();
    await simulator.sendTelemetry(payload);

    // ACK pertama (accepted)
    const firstAck = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(firstAck.status, 'accepted');

    const countBefore = await prisma.sensorReading.count({
      where: { deviceId: testDeviceId, messageId: payload.message_id },
    });
    assert.strictEqual(countBefore, 1);

    // Kirim ulang paket yang persis sama (retry jaringan MQTT)
    await simulator.sendTelemetry(payload);

    // ACK kedua harus berstatus duplicate
    const secondAck = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(secondAck.status, 'duplicate');
    assert.strictEqual(secondAck.reading_id, firstAck.reading_id);

    // Verifikasi jumlah reading di database tidak bertambah
    const countAfter = await prisma.sensorReading.count({
      where: { deviceId: testDeviceId, messageId: payload.message_id },
    });
    assert.strictEqual(countAfter, 1, 'Data tidak boleh terduplikasi');
  });

  it('3. ID sama dengan payload berbeda ditolak dengan MESSAGE_ID_CONFLICT', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    const originalPayload = simulator.createTelemetryPayload();
    await simulator.sendTelemetry(originalPayload);
    const ack1 = await simulator.waitForAck(originalPayload.message_id);
    assert.strictEqual(ack1.status, 'accepted');

    // Buat payload baru dengan message_id sama tapi nilai sensor dimutasi
    const mutatedPayload = {
      ...originalPayload,
      sensors: {
        ...originalPayload.sensors,
        temperature_c: { value: 99.9, quality: 'ok' as const },
      },
    };

    await simulator.sendTelemetry(mutatedPayload);

    const conflictAck = await simulator.waitForAck(originalPayload.message_id);
    assert.strictEqual(conflictAck.status, 'rejected');
    assert.strictEqual(conflictAck.reason_code, 'MESSAGE_ID_CONFLICT');
  });

  it('4. DB outage (simulasi exception storage layer vs network partition): tidak ada ACK berhasil, pulih saat DB aktif', async (t) => {
    if (!brokerUp || !simulator || !worker) return t.skip('Broker tidak tersedia');

    const payload = simulator.createTelemetryPayload();

    // 1. Simulasikan kegagalan database pada worker storage (storage layer exception)
    // Catatan: Outage nyata (koneksi terputus/DB mati) memicu connection retry;
    // simulasi ini memverifikasi bahwa worker tidak menerbitkan ACK sukses saat storage gagal.
    const realStorage = (worker as unknown as { storage: PrismaTelemetryStorage }).storage;
    const failingStorage = {
      ...realStorage,
      insertReading: async () => {
        throw new Error('Database connection simulated outage');
      },
      findCommittedReading: async () => null,
      findDevice: async (id: string) => realStorage.findDevice(id),
      findAssignment: async (id: string, d: Date) => realStorage.findAssignment(id, d),
      findTimeReference: async (id: string, b: string) => realStorage.findTimeReference(id, b),
    };
    (worker as unknown as { storage: unknown }).storage = failingStorage;

    // Kirim telemetry saat database "mati"
    await simulator.sendTelemetry(payload);

    // Pastikan tidak ada ACK berhasil yang diterbitkan
    await assert.rejects(
      async () => {
        await simulator!.waitForAck(payload.message_id, 1200);
      },
      /Timeout waiting for ACK/,
      'Tidak boleh menerbitkan ACK jika transaksi DB gagal'
    );

    // 2. Pulihkan database pada worker
    (worker as unknown as { storage: unknown }).storage = realStorage;

    // 3. Device melakukan retry pengiriman
    await simulator.sendTelemetry(payload);

    // Sekarang ACK accepted berhasil diterima
    const recoveredAck = await simulator.waitForAck(payload.message_id, 3000);
    assert.strictEqual(recoveredAck.status, 'accepted');
  });

  it('5. Worker restart resilience: subscription dan pemrosesan pulih', async (t) => {
    if (!brokerUp || !simulator || !worker) return t.skip('Broker tidak tersedia');

    const committedBeforeRestart = simulator.createTelemetryPayload();
    await simulator.sendTelemetry(committedBeforeRestart);
    const committedAck = await simulator.waitForAck(committedBeforeRestart.message_id);
    assert.strictEqual(committedAck.status, 'accepted');

    // Matikan worker
    await worker.stop();

    // Restart worker baru
    worker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-restarted-${Date.now()}`,
      username: 'worker',
      password: 'workerpass123',
    });
    await worker.start();

    // Retry state yang sudah committed harus tetap dikenali setelah restart.
    await simulator.sendTelemetry(committedBeforeRestart);
    const duplicateAck = await simulator.waitForAck(committedBeforeRestart.message_id);
    assert.strictEqual(duplicateAck.status, 'duplicate');
    assert.strictEqual(duplicateAck.reading_id, committedAck.reading_id);
    assert.strictEqual(
      await prisma.sensorReading.count({ where: { messageId: committedBeforeRestart.message_id } }),
      1
    );

    // Kirim telemetry baru sesudah restart
    const payload = simulator.createTelemetryPayload();
    await simulator.sendTelemetry(payload);

    const ack = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(ack.status, 'accepted');
  });

  it('6. Retained online tidak dianggap traffic live (RETAINED_SNAPSHOT vs LIVE)', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    // Ambil lastSeenAt sebelum status
    const devBefore = await prisma.device.findUnique({ where: { id: testDeviceId } });
    const lastSeenBefore = devBefore?.lastSeenAt?.getTime() || 0;

    // 1. Simulasikan worker menerima status dengan retained = true
    const storage = new PrismaTelemetryStorage(prisma);
    const retainedStatus: StatusPayloadInput = {
      schema_version: 1,
      device_id: 'esp32-001',
      boot_id: simulator.bootId,
      session_id: simulator.sessionId,
      connection_sequence: 1,
      status_sequence: 10,
      event_type: 'connect' as const,
      state: 'online' as const,
      uptime_ms: 1000,
      event_at: new Date().toISOString(),
      clock_synced: true,
    };

    await storage.recordStatusEvent(retainedStatus, true);

    const devAfterRetained = await prisma.device.findUnique({ where: { id: testDeviceId } });
    assert.strictEqual(devAfterRetained?.connectionEvidence, 'RETAINED_SNAPSHOT');
    assert.strictEqual(devAfterRetained?.connectionState, 'UNKNOWN');
    assert.strictEqual(
      devAfterRetained?.lastSeenAt?.getTime() || 0,
      lastSeenBefore,
      'last_seen_at TIDAK boleh maju akibat status retained'
    );

    // 2. Kirim live traffic (retained = false)
    await simulator.publishHeartbeat();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const devAfterLive = await prisma.device.findUnique({ where: { id: testDeviceId } });
    assert.strictEqual(devAfterLive?.connectionState, 'ONLINE');
    assert.ok(
      (devAfterLive?.lastSeenAt?.getTime() || 0) > lastSeenBefore,
      'last_seen_at HARUS maju saat menerima traffic live'
    );
  });

  it('7. ACL per-device: perangkat ditolak mengakses topik perangkat lain', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    // esp32-001 mencoba mempublikasikan data ke topik telemetry milik esp32-002
    // Mosquitto ACL harus memblokir publish ini secara silent atau menolak otorisasi
    const crossTopic = 'esniffer/v1/devices/esp32-002/telemetry';
    const fakePayload = JSON.stringify({
      schema_version: 1,
      device_id: 'esp32-002',
      message_id: 'cross-topic-violation',
    });

    // esp32-001 publish ke esp32-002
    await simulator.sendRaw(crossTopic, fakePayload);

    // Tunggu sejenak
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Pastikan tidak ada reading untuk message_id tersebut yang tersimpan di database
    const saved = await prisma.sensorReading.findFirst({
      where: { messageId: 'cross-topic-violation' },
    });
    assert.strictEqual(saved, null, 'Pesan cross-topic yang melanggar ACL tidak boleh sampai ke worker');
  });

  it('8. Data unknown-time tetap tersimpan dan dapat ditemukan via riwayat perangkat', async (t) => {
    if (!brokerUp || !simulator) return t.skip('Broker tidak tersedia');

    const unknownPayload = simulator.createTelemetryPayload({
      clock_synced: false,
      measured_at: null,
      time_reference: undefined,
    });

    await simulator.sendTelemetry(unknownPayload);

    const ack = await simulator.waitForAck(unknownPayload.message_id);
    assert.strictEqual(ack.status, 'accepted_unresolved_time');
    assert.ok(ack.reading_id);

    // Verifikasi di DB: chamberId = null, assignmentId = null, historySequence = null
    const reading = await prisma.sensorReading.findUnique({
      where: { id: ack.reading_id },
    });
    assert.ok(reading);
    assert.strictEqual(reading.measurementTimeQuality, 'UNKNOWN');
    assert.strictEqual(reading.chamberId, null);
    assert.strictEqual(reading.assignmentId, null);
    assert.strictEqual(reading.historySequence, null);

    // Dapat diaudit melalui query riwayat perangkat
    const auditResults = await prisma.sensorReading.findMany({
      where: { deviceId: testDeviceId, measurementTimeQuality: 'UNKNOWN' },
    });
    assert.ok(auditResults.some((r) => r.id === ack.reading_id));
  });

  it('9. Publish ACK gagal setelah commit, kemudian retry mendapat duplicate', async (t) => {
    if (!brokerUp || !simulator || !worker) return t.skip('Broker tidak tersedia');

    const payload = simulator.createTelemetryPayload();

    // 1. Simulasikan kegagalan publish ACK tepat sesudah commit
    const realPublishAck = worker.publishAck.bind(worker);
    let failAckOnce = true;

    worker.publishAck = async (topic: string, ackStr: string) => {
      if (failAckOnce) {
        failAckOnce = false;
        throw new Error('Simulated network glitch during ACK publish');
      }
      return realPublishAck(topic, ackStr);
    };

    // Kirim telemetry
    await simulator.sendTelemetry(payload);

    // Device tidak menerima ACK karena kegagalan publish
    await assert.rejects(
      async () => {
        await simulator!.waitForAck(payload.message_id, 1200);
      },
      /Timeout waiting for ACK/
    );

    // Verifikasi: Data SEBENARNYA SUDAH TERSIMPAN di database
    const saved = await prisma.sensorReading.findFirst({
      where: { messageId: payload.message_id },
    });
    assert.ok(saved, 'Data sudah tersimpan di database sebelum ACK publish gagal');

    // 2. Karena tidak menerima ACK, device melakukan retry paket yang sama
    await simulator.sendTelemetry(payload);

    // Worker mendeteksi duplikat komit, menerbitkan ACK duplicate dengan reading_id yang sama
    const duplicateAck = await simulator.waitForAck(payload.message_id, 3000);
    assert.strictEqual(duplicateAck.status, 'duplicate');
    assert.strictEqual(duplicateAck.reading_id, saved.id);

    // Kembalikan publishAck normal
    worker.publishAck = realPublishAck;
  });

  it('10. Worker queue capacity: antrean dibatasi maxQueueSize dan melepaskan backpressure log', async () => {
    // Verifikasi konfigurasi bounded queue
    const boundedWorker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-bounded-${Date.now()}`,
      maxQueueSize: 3,
      concurrencyLimit: 1,
    });

    const config = (boundedWorker as unknown as { config: { maxQueueSize: number } }).config;
    assert.strictEqual(config.maxQueueSize, 3, 'maxQueueSize harus dikonfigurasi ke 3');

    // Simulasikan 4 pesan masuk secara langsung ke handleIncomingMessage
    const mockPacket = { cmd: 'publish', qos: 1, dup: false, retain: false, topic: 'dummy' } as const;
    const workerInternal = boundedWorker as unknown as {
      queue: unknown[];
      isRunning: boolean;
      handleIncomingMessage: (topic: string, payload: Buffer, packet: unknown) => void;
    };
    workerInternal.isRunning = true;

    // Tiga pesan pertama diterima masuk antrean
    workerInternal.handleIncomingMessage('topic1', Buffer.from('{}'), mockPacket);
    workerInternal.handleIncomingMessage('topic2', Buffer.from('{}'), mockPacket);
    workerInternal.handleIncomingMessage('topic3', Buffer.from('{}'), mockPacket);

    // Antrean kini mencapai batas (3)
    assert.ok(workerInternal.queue.length <= 3, 'Antrean tidak boleh melebihi maxQueueSize');

    // Pesan ke-4 harus didrop karena antrean penuh (backpressure)
    workerInternal.handleIncomingMessage('topic4', Buffer.from('{}'), mockPacket);
    assert.strictEqual(workerInternal.queue.length, 3, 'Pesan ke-4 harus didrop saat antrean penuh');
  });

  it('11. Graceful shutdown berhenti menerima pesan baru dan menguras seluruh antrean', async () => {
    const drainingWorker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-drain-${Date.now()}`,
      username: 'worker',
      password: 'workerpass123',
      maxQueueSize: 4,
      concurrencyLimit: 1,
    });
    const processed: string[] = [];
    const workerInternal = drainingWorker as unknown as {
      isRunning: boolean;
      isStopping: boolean;
      queue: unknown[];
      handleIncomingMessage: (topic: string, payload: Buffer, packet: unknown) => void;
      dispatchMessage: (topic: string) => Promise<void>;
    };
    workerInternal.dispatchMessage = async (topic: string) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      processed.push(topic);
    };
    workerInternal.isRunning = true;

    const packet = { cmd: 'publish', qos: 1, dup: false, retain: false, topic: 'dummy' } as const;
    workerInternal.handleIncomingMessage('queued-1', Buffer.from('{}'), packet);
    workerInternal.handleIncomingMessage('queued-2', Buffer.from('{}'), packet);
    workerInternal.handleIncomingMessage('queued-3', Buffer.from('{}'), packet);

    const stopping = drainingWorker.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    workerInternal.handleIncomingMessage('late-message', Buffer.from('{}'), packet);
    await stopping;

    assert.deepStrictEqual(processed, ['queued-1', 'queued-2', 'queued-3']);
    assert.strictEqual(workerInternal.queue.length, 0);
    assert.strictEqual(workerInternal.isRunning, false);
    assert.strictEqual(workerInternal.isStopping, false);
  });
});
