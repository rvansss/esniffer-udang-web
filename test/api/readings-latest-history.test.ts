import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, allocateHistorySequence, closeDb } from '../../lib/db/client.ts';
import { GET as getLatestHandler } from '../../app/api/v1/chambers/[chamberId]/latest/route.ts';
import { GET as getHistoryHandler } from '../../app/api/v1/chambers/[chamberId]/history/route.ts';
import { GET as getDeviceReadingsHandler } from '../../app/api/v1/devices/[deviceId]/readings/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { randomUUID } from 'node:crypto';

describe('HTTP API v1: Latest Reading, Keyset History, and Device Audit Tests', () => {
  let adminCookie = '';
  let adminUserId = '';
  const testPrefix = `rh-${Date.now().toString().slice(-4)}`;
  const chamberCode = `CH-${testPrefix}`;
  const deviceMqttId = `esp32-${testPrefix}`;
  let chamberId = '';
  let deviceId = '';
  let assignmentId = '';

  const bootId = randomUUID();
  const readingIds: string[] = [];

  before(async () => {
    // 1. Buat user admin & sesi
    const passwordHash = await hashPassword('AdminPass123!');
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${testPrefix}@esniffer.local`,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = adminUser.id;
    const { rawToken, expiresAt } = await createSession(adminUser.id);
    adminCookie = buildSessionCookie(rawToken, expiresAt).split(';')[0];

    // 2. Buat chamber
    const chamber = await prisma.chamber.create({
      data: {
        code: chamberCode,
        name: `Chamber ${testPrefix}`,
        isActive: true,
      },
    });
    chamberId = chamber.id;

    // 3. Buat device
    const device = await prisma.device.create({
      data: {
        mqttDeviceId: deviceMqttId,
        name: `Device ${testPrefix}`,
        isActive: true,
        connectionState: 'ONLINE',
        connectionEvidence: 'LIVE_STATUS',
        lastSeenAt: new Date(),
      },
    });
    deviceId = device.id;

    // 4. Buat assignment aktif
    const assignment = await prisma.deviceAssignment.create({
      data: {
        deviceId,
        chamberId,
        activeFrom: new Date('2026-09-01T00:00:00Z'),
        activeUntil: null,
      },
    });
    assignmentId = assignment.id;
  });

  after(async () => {
    // Bersihkan data
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await closeDb();
  });

  it('1. GET latest saat belum ada reading: reading bernilai null dan freshness unknown', async () => {
    const req = new Request(`http://localhost:3000/api/v1/chambers/${chamberCode}/latest`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });

    const res = await getLatestHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.data.chamber.code, chamberCode);
    assert.strictEqual(body.data.devices.length, 1);

    const devStatus = body.data.devices[0];
    assert.strictEqual(devStatus.connection.state, 'ONLINE');
    assert.strictEqual(devStatus.connection.evidence, 'LIVE_STATUS');
    assert.strictEqual(devStatus.freshness.state, 'unknown');
    assert.strictEqual(devStatus.freshness.ageSeconds, null);
    assert.strictEqual(devStatus.reading, null, 'Reading harus null jika belum ada data known-time');
  });

  it('2. Data unknown-time TIDAK dipromosikan sebagai latest chamber', async () => {
    // Insert reading unknown-time (chamber_id = null, measured_at = null)
    const unknownReading = await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId: null, // unknown-time tidak mengklaim chamber
        messageId: `${bootId}:0000000001`,
        payloadSha256: 'a'.repeat(64),
        bootId,
        sequence: 1n,
        sampleUptimeMs: 1000n,
        measuredAt: null,
        receivedAt: new Date(),
        measurementTimeQuality: 'UNKNOWN',
        temperatureC: 28.5,
        temperatureQuality: 'OK',
        humidityPercent: 70.0,
        humidityQuality: 'OK',
        mq137Raw: 1500,
        mq137Quality: 'OK',
        mq136Raw: null,
        mq136Quality: 'SENSOR_ERROR',
        mq4Raw: 800,
        mq4Quality: 'OK',
        rawPayload: {},
      },
    });
    readingIds.push(unknownReading.id);

    // Pastikan GET latest chamber tetap mengembalikan reading = null
    const req = new Request(`http://localhost:3000/api/v1/chambers/${chamberCode}/latest`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const res = await getLatestHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    const body = await res.json();
    assert.strictEqual(body.data.devices[0].reading, null, 'Unknown-time reading tidak boleh masuk latest');
  });

  it('3. GET latest mengembalikan pemisahan 3 dimensi (koneksi, freshness, kualitas sensor) saat ada reading known-time', async () => {
    const recentMeasuredAt = new Date(Date.now() - 3000); // 3 detik lalu (fresh)
    const seq = await allocateHistorySequence();

    const knownReading = await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        messageId: `${bootId}:0000000002`,
        payloadSha256: 'b'.repeat(64),
        bootId,
        sequence: 2n,
        sampleUptimeMs: 2000n,
        measuredAt: recentMeasuredAt,
        receivedAt: new Date(),
        measurementTimeQuality: 'SYNCED',
        historySequence: seq,
        temperatureC: 26.55,
        temperatureQuality: 'OK',
        humidityPercent: 75.2,
        humidityQuality: 'OK',
        mq137Raw: 1820,
        mq137Quality: 'OK',
        mq136Raw: null,
        mq136Quality: 'SENSOR_ERROR',
        mq4Raw: 910,
        mq4Quality: 'OK',
        rawPayload: {},
      },
    });
    readingIds.push(knownReading.id);

    const req = new Request(`http://localhost:3000/api/v1/chambers/${chamberCode}/latest`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });
    const res = await getLatestHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const dev = body.data.devices[0];

    // Dimensi 1: Koneksi
    assert.strictEqual(dev.connection.state, 'ONLINE');
    // Dimensi 2: Freshness
    assert.strictEqual(dev.freshness.state, 'fresh');
    assert.ok(dev.freshness.ageSeconds !== null && dev.freshness.ageSeconds <= 15);
    // Dimensi 3: Sensor Values & Qualities
    assert.ok(dev.reading);
    assert.strictEqual(dev.reading.values.temperatureC.value, 26.55);
    assert.strictEqual(dev.reading.values.temperatureC.quality, 'OK');
    assert.strictEqual(dev.reading.values.mq136Raw.value, null);
    assert.strictEqual(dev.reading.values.mq136Raw.quality, 'SENSOR_ERROR');
  });

  it('4. Keyset Pagination pada History: mematuhi watermark dan traversal antar halaman konsisten', async () => {
    // Buat 4 reading tambahan (total 5 known-time readings)
    const baseTime = Date.now() - 60000;
    for (let i = 3; i <= 6; i++) {
      const seq = await allocateHistorySequence();
      const r = await prisma.sensorReading.create({
        data: {
          deviceId,
          chamberId,
          assignmentId,
          messageId: `${bootId}:000000000${i}`,
          payloadSha256: `${i}`.repeat(64),
          bootId,
          sequence: BigInt(i),
          measuredAt: new Date(baseTime + i * 2000),
          receivedAt: new Date(),
          measurementTimeQuality: 'SYNCED',
          historySequence: seq,
          temperatureC: 25.0 + i,
          temperatureQuality: 'OK',
          humidityPercent: 70.0,
          humidityQuality: 'OK',
          mq137Raw: 1000 + i,
          mq137Quality: 'OK',
          mq136Raw: 1000 + i,
          mq136Quality: 'OK',
          mq4Raw: 1000 + i,
          mq4Quality: 'OK',
          rawPayload: {},
        },
      });
      readingIds.push(r.id);
    }

    const fromStr = new Date(baseTime - 10000).toISOString();
    const toStr = new Date().toISOString();

    // Halaman 1 (limit = 2)
    const page1Req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/history?from=${fromStr}&to=${toStr}&limit=2`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const page1Res = await getHistoryHandler(page1Req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(page1Res.status, 200);
    const page1Body = await page1Res.json();

    assert.strictEqual(page1Body.data.length, 2);
    assert.ok(page1Body.meta.nextCursor, 'Halaman 1 harus mengembalikan nextCursor');
    const watermark1 = page1Body.meta.snapshotWatermark;
    assert.ok(watermark1, 'Snapshot watermark harus ada');

    // Simulasikan transaksi baru yang commit SETELAH Halaman 1 dibaca (late-commit di atas watermark)
    const lateSeq = await allocateHistorySequence();
    const lateReading = await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        messageId: `${bootId}:0000000099`,
        payloadSha256: '9'.repeat(64),
        bootId,
        sequence: 99n,
        measuredAt: new Date(), // Waktu kini
        receivedAt: new Date(),
        measurementTimeQuality: 'SYNCED',
        historySequence: lateSeq, // Sequence di atas watermark
        temperatureC: 30.0,
        temperatureQuality: 'OK',
        humidityPercent: 80.0,
        humidityQuality: 'OK',
        mq137Raw: 2000,
        mq137Quality: 'OK',
        mq136Raw: 2000,
        mq136Quality: 'OK',
        mq4Raw: 2000,
        mq4Quality: 'OK',
        rawPayload: {},
      },
    });
    readingIds.push(lateReading.id);

    // Halaman 2 menggunakan cursor Halaman 1
    const page2Req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/history?from=${fromStr}&to=${toStr}&limit=2&cursor=${page1Body.meta.nextCursor}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const page2Res = await getHistoryHandler(page2Req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(page2Res.status, 200);
    const page2Body = await page2Res.json();

    assert.strictEqual(page2Body.data.length, 2);
    assert.ok(page2Body.meta.nextCursor);

    // Pastikan late-commit reading TIDAK muncul di tengah traversal pagination
    const allRetrievedIds = [...page1Body.data.map((r: { id: string }) => r.id), ...page2Body.data.map((r: { id: string }) => r.id)];
    assert.ok(!allRetrievedIds.includes(lateReading.id), 'Data di atas snapshot watermark tidak boleh bocor ke traversal');

    // Halaman 3 (sisa reading)
    const page3Req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/history?from=${fromStr}&to=${toStr}&limit=2&cursor=${page2Body.meta.nextCursor}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const page3Res = await getHistoryHandler(page3Req, { params: Promise.resolve({ chamberId: chamberCode }) });
    const page3Body = await page3Res.json();
    assert.strictEqual(page3Body.data.length, 1);
    assert.strictEqual(page3Body.meta.nextCursor, null, 'Halaman terakhir harus mengembalikan nextCursor null');
  });

  it('5. Audit Perangkat: GET /api/v1/devices/[deviceId]/readings?quality=UNKNOWN menemukan data tak berwaktu', async () => {
    const req = new Request(`http://localhost:3000/api/v1/devices/${deviceMqttId}/readings?quality=UNKNOWN`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    });

    const res = await getDeviceReadingsHandler(req, { params: Promise.resolve({ deviceId: deviceMqttId }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.ok(body.data.length >= 1);
    const found = body.data.find((r: { messageId: string }) => r.messageId === `${bootId}:0000000001`);
    assert.ok(found, 'Data unknown-time harus dapat diaudit via riwayat perangkat');
    assert.strictEqual(found.measurementTimeQuality, 'UNKNOWN');
    assert.strictEqual(found.chamberId, null);
  });
});
