import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { prisma, closeDb } from '../../lib/db/client.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { WorkerDaemon } from '../../worker/index.ts';
import { DeviceSimulator } from './simulator.ts';
import type { StatusPayloadInput } from '../../shared/types.ts';

const MQTT_URL = 'mqtt://127.0.0.1:1883';
const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = await read();
  while (!accept(lastValue) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    lastValue = await read();
  }
  assert.ok(accept(lastValue), `Kondisi tidak tercapai dalam ${timeoutMs} ms`);
  return lastValue;
}

async function assertPortAvailable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Port 127.0.0.1:${port} tidak tersedia`));
    });
    socket.connect(port, '127.0.0.1');
  });
}

describe('Full-stack trace: simulator → MQTT → worker → PostgreSQL → API → dashboard', () => {
  const runId = crypto.randomUUID().slice(0, 8);
  const email = `full-stack-${runId}@esniffer.local`;
  const password = 'FullStackTrace123!';

  let server: ChildProcess | null = null;
  let worker: WorkerDaemon | null = null;
  let simulator: DeviceSimulator | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let userId = '';
  let deviceId = '';
  let chamberId = '';
  let assignmentId = '';
  let originalDeviceState: {
    isActive: boolean;
    connectionState: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
    connectionEvidence: 'NONE' | 'LIVE_STATUS' | 'LIVE_TELEMETRY' | 'RETAINED_SNAPSHOT' | 'LWT';
    lastSeenAt: Date | null;
    lastStatusProcessedAt: Date | null;
    lastStatusEventAt: Date | null;
    currentBootId: string | null;
    currentSessionId: string | null;
    currentConnectionSeq: bigint | null;
    currentStatusSequence: bigint | null;
  } | null = null;

  before(async () => {
    await assertPortAvailable(5432);
    await assertPortAvailable(1883);

    const chamber = await prisma.chamber.findUnique({ where: { code: 'CH-01' } });
    assert.ok(chamber, 'Seed chamber CH-01 harus tersedia');
    chamberId = chamber.id;

    const device = await prisma.device.findUnique({ where: { mqttDeviceId: 'esp32-001' } });
    assert.ok(device, 'Seed device esp32-001 harus tersedia');
    deviceId = device.id;
    originalDeviceState = {
      isActive: device.isActive,
      connectionState: device.connectionState,
      connectionEvidence: device.connectionEvidence,
      lastSeenAt: device.lastSeenAt,
      lastStatusProcessedAt: device.lastStatusProcessedAt,
      lastStatusEventAt: device.lastStatusEventAt,
      currentBootId: device.currentBootId,
      currentSessionId: device.currentSessionId,
      currentConnectionSeq: device.currentConnectionSeq,
      currentStatusSequence: device.currentStatusSequence,
    };

    await prisma.device.update({ where: { id: deviceId }, data: { isActive: true } });
    const assignment = await prisma.deviceAssignment.findFirst({
      where: { deviceId, chamberId, activeUntil: null },
      orderBy: { activeFrom: 'desc' },
    });
    assert.ok(assignment, 'Assignment aktif esp32-001 → CH-01 harus tersedia');
    assignmentId = assignment.id;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
        isActive: true,
      },
    });
    userId = user.id;

    server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        APP_BASE_URL: BASE_URL,
        AUTH_SECRET: 'full-stack-trace-auth-secret-key-32-chars',
        CURSOR_SIGNING_SECRET: 'full-stack-trace-cursor-secret-32-chars',
      },
      stdio: 'pipe',
    });

    let serverReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(`${BASE_URL}/api/v1/auth/session`);
        if (response.status === 401) {
          serverReady = true;
          break;
        }
      } catch {
        // Server masih mulai.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(serverReady, `Next.js harus siap di ${BASE_URL}`);

    worker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-full-stack-${runId}`,
      username: 'worker',
      password: 'workerpass123',
    });
    await worker.start();

    simulator = new DeviceSimulator({
      mqttUrl: MQTT_URL,
      deviceId: 'esp32-001',
      password: 'devicepass001',
      firmwareVersion: `trace-${runId}`,
    });
    await simulator.connect();

    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  });

  after(async () => {
    if (browser) await browser.close();
    if (simulator) await simulator.disconnect();
    if (worker) await worker.stop();
    if (server && !server.killed) server.kill('SIGTERM');

    try {
      if (simulator) {
        await prisma.sensorReading.deleteMany({ where: { bootId: simulator.bootId } });
        await prisma.deviceTimeReference.deleteMany({ where: { bootId: simulator.bootId } });
      }
      if (userId) {
        await prisma.authSession.deleteMany({ where: { userId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (deviceId && originalDeviceState) {
        await prisma.device.update({ where: { id: deviceId }, data: originalDeviceState });
      }
    } finally {
      await closeDb();
    }
  });

  it('membuktikan happy path, integrity, waktu, status, API, dan UI pada trace yang sama', { timeout: 45000 }, async () => {
    assert.ok(simulator && worker && page);

    const beforeLive = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    await simulator.publishHeartbeat(15000);
    const afterLive = await waitFor(
      () => prisma.device.findUniqueOrThrow({ where: { id: deviceId } }),
      (device) => device.connectionState === 'ONLINE' &&
        device.connectionEvidence === 'LIVE_STATUS' &&
        device.currentSessionId === simulator!.sessionId &&
        (device.lastSeenAt?.getTime() || 0) > (beforeLive.lastSeenAt?.getTime() || 0)
    );

    await worker.stop();
    const lastSeenAfterLive = afterLive.lastSeenAt!;
    worker = new WorkerDaemon({
      mqttUrl: MQTT_URL,
      clientId: `worker-full-stack-replay-${runId}`,
      username: 'worker',
      password: 'workerpass123',
    });
    await worker.start();

    const afterRetainedReplay = await waitFor(
      () => prisma.device.findUniqueOrThrow({ where: { id: deviceId } }),
      (device) => device.connectionState === 'UNKNOWN' &&
        device.connectionEvidence === 'RETAINED_SNAPSHOT'
    );
    assert.strictEqual(
      afterRetainedReplay.lastSeenAt?.toISOString(),
      lastSeenAfterLive.toISOString(),
      'Replay retained tidak boleh memajukan last_seen_at'
    );

    await simulator.publishHeartbeat(20000);
    const afterRecoveryHeartbeat = await waitFor(
      () => prisma.device.findUniqueOrThrow({ where: { id: deviceId } }),
      (device) => device.connectionState === 'ONLINE' &&
        device.connectionEvidence === 'LIVE_STATUS' &&
        (device.lastSeenAt?.getTime() || 0) > lastSeenAfterLive.getTime()
    );

    const measuredAt = new Date();
    const payload = simulator.createTelemetryPayload({
      measured_at: measuredAt.toISOString(),
      sample_uptime_ms: 25000,
      sensors: {
        temperature_c: { value: 31.234, quality: 'ok' },
        humidity_percent: { value: 68.765, quality: 'ok' },
        mq137_raw: { value: 3210, quality: 'ok' },
        mq136_raw: { value: null, quality: 'sensor_error' },
        mq4_raw: { value: 876, quality: 'ok' },
      },
    });

    await simulator.sendTelemetry(payload);
    const acceptedAck = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(acceptedAck.status, 'accepted');
    assert.ok(acceptedAck.reading_id);

    const saved = await prisma.sensorReading.findUnique({
      where: { id: acceptedAck.reading_id },
      include: { device: true, chamber: true, assignment: true },
    });
    assert.ok(saved, 'ACK accepted harus menunjuk row yang sudah committed');
    assert.strictEqual(saved.messageId, payload.message_id);
    assert.strictEqual(saved.payloadSha256, acceptedAck.payload_sha256);
    assert.strictEqual(saved.receivedAt.toISOString(), acceptedAck.received_at);
    assert.strictEqual(saved.deviceId, deviceId);
    assert.strictEqual(saved.device.mqttDeviceId, 'esp32-001');
    assert.strictEqual(saved.chamberId, chamberId);
    assert.strictEqual(saved.chamber?.code, 'CH-01');
    assert.strictEqual(saved.assignmentId, assignmentId);
    assert.strictEqual(saved.assignment?.deviceId, deviceId);
    assert.strictEqual(saved.assignment?.chamberId, chamberId);
    assert.strictEqual(saved.mq136Raw, null);
    assert.strictEqual(saved.mq136Quality, 'SENSOR_ERROR');

    await simulator.sendTelemetry(payload);
    const duplicateAck = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(duplicateAck.status, 'duplicate');
    assert.strictEqual(duplicateAck.reading_id, saved.id);
    assert.strictEqual(
      await prisma.sensorReading.count({ where: { deviceId, messageId: payload.message_id } }),
      1
    );

    const conflictingPayload = {
      ...payload,
      sensors: {
        ...payload.sensors,
        temperature_c: { value: 32.234, quality: 'ok' as const },
      },
    };
    await simulator.sendTelemetry(conflictingPayload);
    const conflictAck = await simulator.waitForAck(payload.message_id);
    assert.strictEqual(conflictAck.status, 'rejected');
    assert.strictEqual(conflictAck.reason_code, 'MESSAGE_ID_CONFLICT');
    assert.strictEqual(
      await prisma.sensorReading.count({ where: { deviceId, messageId: payload.message_id } }),
      1
    );

    const unknownPayload = simulator.createTelemetryPayload({
      clock_synced: false,
      measured_at: null,
      sample_uptime_ms: 30000,
    });
    await simulator.sendTelemetry(unknownPayload);
    const unknownAck = await simulator.waitForAck(unknownPayload.message_id);
    assert.strictEqual(unknownAck.status, 'accepted_unresolved_time');
    const unknownReading = await prisma.sensorReading.findUniqueOrThrow({ where: { id: unknownAck.reading_id } });
    assert.strictEqual(unknownReading.measurementTimeQuality, 'UNKNOWN');
    assert.strictEqual(unknownReading.measuredAt, null);
    assert.strictEqual(unknownReading.chamberId, null);
    assert.strictEqual(unknownReading.assignmentId, null);
    assert.strictEqual(unknownReading.historySequence, null);

    const anchorReference = `trace-anchor-${runId}`;
    const anchorUtc = new Date(measuredAt.getTime() - 6000);
    const anchorStatus: StatusPayloadInput = {
      schema_version: 1,
      device_id: simulator.deviceId,
      boot_id: simulator.bootId,
      session_id: simulator.sessionId,
      connection_sequence: simulator.connectionSeq,
      status_sequence: ++simulator.statusSeq,
      event_type: 'heartbeat',
      state: 'online',
      uptime_ms: 50000,
      event_at: new Date().toISOString(),
      clock_synced: true,
      firmware_version: `trace-${runId}`,
      time_reference: {
        reference_id: anchorReference,
        anchor_utc: anchorUtc.toISOString(),
        anchor_uptime_ms: 50000,
        uncertainty_ms: 25,
        source: 'trace-test',
      },
    };
    await simulator.sendRaw(
      `esniffer/v1/devices/${simulator.deviceId}/status`,
      JSON.stringify(anchorStatus)
    );
    const storedAnchor = await waitFor(
      () => prisma.deviceTimeReference.findFirst({ where: { deviceId, bootId: simulator!.bootId, referenceKey: anchorReference } }),
      (reference) => reference !== null
    );
    assert.ok(storedAnchor);

    const reconstructedPayload = simulator.createTelemetryPayload({
      clock_synced: false,
      measured_at: null,
      sample_uptime_ms: 51000,
      time_reference: undefined,
    });
    await simulator.sendTelemetry(reconstructedPayload);
    const reconstructedAck = await simulator.waitForAck(reconstructedPayload.message_id);
    assert.strictEqual(reconstructedAck.status, 'accepted');
    const reconstructedReading = await prisma.sensorReading.findUniqueOrThrow({ where: { id: reconstructedAck.reading_id } });
    assert.strictEqual(reconstructedReading.measurementTimeQuality, 'RECONSTRUCTED');
    assert.strictEqual(reconstructedReading.timeReferenceId, storedAnchor.id);
    assert.strictEqual(reconstructedReading.measuredAt?.toISOString(), new Date(anchorUtc.getTime() + 1000).toISOString());

    const loginResponse = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email, password }),
    });
    assert.strictEqual(loginResponse.status, 200);
    const sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
    assert.ok(sessionCookie);
    const authHeaders = { Cookie: sessionCookie };

    const latestResponse = await fetch(
      `${BASE_URL}/api/v1/chambers/CH-01/latest?deviceId=esp32-001`,
      { headers: authHeaders }
    );
    assert.strictEqual(latestResponse.status, 200);
    const latestBody = await latestResponse.json();
    const latestDevice = latestBody.data.devices[0];
    assert.strictEqual(latestDevice.reading.id, saved.id);
    assert.strictEqual(latestDevice.reading.measuredAt, measuredAt.toISOString());
    assert.strictEqual(latestDevice.reading.values.temperatureC.value, 31.234);
    assert.strictEqual(latestDevice.reading.values.mq136Raw.value, null);
    assert.strictEqual(latestDevice.reading.values.mq136Raw.quality, 'SENSOR_ERROR');

    const rangeFrom = new Date(measuredAt.getTime() - 1).toISOString();
    const rangeTo = new Date(measuredAt.getTime() + 1).toISOString();
    const historyResponse = await fetch(
      `${BASE_URL}/api/v1/chambers/CH-01/history?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}&deviceId=esp32-001`,
      { headers: authHeaders }
    );
    assert.strictEqual(historyResponse.status, 200);
    const historyBody = await historyResponse.json();
    assert.strictEqual(historyBody.data.length, 1);
    assert.strictEqual(historyBody.data[0].id, saved.id);
    assert.strictEqual(historyBody.data[0].messageId, payload.message_id);

    const seriesResponse = await fetch(
      `${BASE_URL}/api/v1/chambers/CH-01/series?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}&deviceId=esp32-001&bucket=5s&metrics=temperatureC,mq136Raw`,
      { headers: authHeaders }
    );
    assert.strictEqual(seriesResponse.status, 200);
    const seriesBody = await seriesResponse.json();
    assert.strictEqual(seriesBody.data.length, 1);
    assert.strictEqual(seriesBody.data[0].totalCount, 1);
    assert.strictEqual(seriesBody.data[0].metrics.temperatureC.avg, 31.234);
    assert.strictEqual(seriesBody.data[0].metrics.mq136Raw.avg, null);
    assert.strictEqual(seriesBody.data[0].metrics.mq136Raw.invalidCount, 1);

    const auditResponse = await fetch(
      `${BASE_URL}/api/v1/devices/esp32-001/readings?quality=UNKNOWN&limit=100`,
      { headers: authHeaders }
    );
    assert.strictEqual(auditResponse.status, 200);
    const auditBody = await auditResponse.json();
    assert.ok(auditBody.data.some((item: { id: string }) => item.id === unknownReading.id));
    assert.ok(!historyBody.data.some((item: { id: string }) => item.id === unknownReading.id));

    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await page.type('#email', email);
    await page.type('#password', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]'),
    ]);

    const browserLatestPromise = page.waitForResponse(
      (response) => response.url().includes('/api/v1/chambers/CH-01/latest') && response.status() === 200,
      { timeout: 8000 }
    );
    await page.goto(`${BASE_URL}/chamber/CH-01`, { waitUntil: 'domcontentloaded' });
    const browserLatestResponse = await browserLatestPromise;
    const browserLatestBody = await browserLatestResponse.json();
    const browserReading = browserLatestBody.data.devices.find(
      (entry: { device: { mqttDeviceId: string } }) => entry.device.mqttDeviceId === 'esp32-001'
    ).reading;
    assert.strictEqual(browserReading.id, saved.id);
    assert.strictEqual(browserReading.measuredAt, measuredAt.toISOString());

    await page.waitForFunction(
      () => (document.body.textContent || '').includes('31.2'),
      { timeout: 8000 }
    );
    const dashboardText = await page.evaluate(() => document.body.textContent || '');
    assert.ok(dashboardText.includes('3210.00'), 'Dashboard harus menampilkan nilai MQ-137 trace');
    assert.ok(dashboardText.includes('SENSOR_ERROR'), 'Dashboard harus menampilkan quality sensor trace');
    const mq136Card = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('div'));
      return candidates
        .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() || '')
        .find((text) => text.includes('MQ-136') && text.includes('--') && text.includes('SENSOR_ERROR')) || null;
    });
    assert.ok(mq136Card, 'Dashboard harus menampilkan MQ-136 sebagai -- dengan SENSOR_ERROR');

    console.log(`FULL_STACK_TRACE ${JSON.stringify({
      runId,
      mqtt: {
        topic: `esniffer/v1/devices/${simulator.deviceId}/telemetry`,
        messageId: payload.message_id,
        measuredAt: payload.measured_at,
      },
      ack: {
        status: acceptedAck.status,
        readingId: acceptedAck.reading_id,
        payloadSha256: acceptedAck.payload_sha256,
        receivedAt: acceptedAck.received_at,
      },
      database: {
        readingId: saved.id,
        deviceId: saved.deviceId,
        chamberId: saved.chamberId,
        assignmentId: saved.assignmentId,
        messageId: saved.messageId,
        measuredAt: saved.measuredAt?.toISOString(),
        mq136: { value: saved.mq136Raw, quality: saved.mq136Quality },
      },
      api: {
        latestReadingId: latestDevice.reading.id,
        historyReadingId: historyBody.data[0].id,
        historyMessageId: historyBody.data[0].messageId,
        seriesBucket: seriesBody.data[0].bucketStart,
      },
      ui: {
        latestResponseReadingId: browserReading.id,
        measuredAt: browserReading.measuredAt,
        temperatureRendered: '31.2',
        mq137Rendered: '3210.00',
        mq136Rendered: '-- / SENSOR_ERROR',
      },
      integrity: {
        duplicateStatus: duplicateAck.status,
        conflictReason: conflictAck.reason_code,
        unknownReadingId: unknownReading.id,
        reconstructedReadingId: reconstructedReading.id,
      },
      status: {
        liveLastSeenAt: afterLive.lastSeenAt?.toISOString(),
        retainedEvidence: afterRetainedReplay.connectionEvidence,
        retainedLastSeenAt: afterRetainedReplay.lastSeenAt?.toISOString(),
        recoveredLastSeenAt: afterRecoveryHeartbeat.lastSeenAt?.toISOString(),
      },
    })}`);
  });
});
