import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { prisma, allocateHistorySequence, closeDb } from '../../lib/db/client.ts';
import { GET as getSeriesHandler } from '../../app/api/v1/chambers/[chamberId]/series/route.ts';
import { GET as getExportHandler } from '../../app/api/v1/chambers/[chamberId]/export/route.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { sanitizeCsvCell, buildCsvRow } from '../../lib/api/csv.ts';
import { randomUUID } from 'node:crypto';

describe('HTTP API v1: Time-Bucket Series & Safe CSV Export Tests', () => {
  let adminCookie = '';
  let adminUserId = '';
  const testPrefix = `se-${Date.now().toString().slice(-4)}`;
  const chamberCode = `CH-${testPrefix}`;
  const deviceMqttId = `esp32-${testPrefix}`;
  let chamberId = '';
  let deviceId = '';
  let assignmentId = '';

  const bootId = randomUUID();
  const testBaseTime = new Date('2026-09-15T10:00:00.000Z');

  before(async () => {
    // 1. Buat user admin
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

    // 5. Seed data pembacaan dalam 1 bucket waktu yang sama (10:00:00 - 10:00:20)
    // Sensor temperature_c: 20.0, 30.0, dan NULL (sensor_error)
    // Rata-rata HARUS (20 + 30) / 2 = 25.0, BUKAN (20 + 30 + 0) / 3 = 16.666!
    const seq1 = await allocateHistorySequence();
    await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        messageId: `${bootId}:0000000001`,
        payloadSha256: '1'.repeat(64),
        bootId,
        sequence: 1n,
        measuredAt: new Date(testBaseTime.getTime() + 2000), // 10:00:02
        receivedAt: new Date(),
        measurementTimeQuality: 'SYNCED',
        historySequence: seq1,
        temperatureC: 20.0,
        temperatureQuality: 'OK',
        humidityPercent: 60.0,
        humidityQuality: 'OK',
        mq137Raw: 1000,
        mq137Quality: 'OK',
        mq136Raw: 500,
        mq136Quality: 'OK',
        mq4Raw: 300,
        mq4Quality: 'OK',
        rawPayload: {},
      },
    });

    const seq2 = await allocateHistorySequence();
    await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        messageId: `${bootId}:0000000002`,
        payloadSha256: '2'.repeat(64),
        bootId,
        sequence: 2n,
        measuredAt: new Date(testBaseTime.getTime() + 4000), // 10:00:04
        receivedAt: new Date(),
        measurementTimeQuality: 'SYNCED',
        historySequence: seq2,
        temperatureC: 30.0,
        temperatureQuality: 'OK',
        humidityPercent: 70.0,
        humidityQuality: 'OK',
        mq137Raw: 1200,
        mq137Quality: 'OK',
        mq136Raw: null, // SENSOR_ERROR
        mq136Quality: 'SENSOR_ERROR',
        mq4Raw: 350,
        mq4Quality: 'OK',
        rawPayload: {},
      },
    });

    const seq3 = await allocateHistorySequence();
    await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        messageId: `${bootId}:0000000003`,
        payloadSha256: '3'.repeat(64),
        bootId,
        sequence: 3n,
        measuredAt: new Date(testBaseTime.getTime() + 6000), // 10:00:06
        receivedAt: new Date(),
        measurementTimeQuality: 'SYNCED',
        historySequence: seq3,
        temperatureC: null, // SENSOR_ERROR (null)
        temperatureQuality: 'SENSOR_ERROR',
        humidityPercent: 80.0,
        humidityQuality: 'OK',
        mq137Raw: 1400,
        mq137Quality: 'OK',
        mq136Raw: 700,
        mq136Quality: 'OK',
        mq4Raw: null,
        mq4Quality: 'OUT_OF_RANGE',
        rawPayload: {},
      },
    });
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await closeDb();
  });

  it('1. GET /api/v1/chambers/[chamberId]/series mengabaikan nilai NULL dari agregasi numerik (tidak dianggap nol)', async () => {
    const fromStr = new Date(testBaseTime.getTime() - 1000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 60000).toISOString();

    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/series?from=${fromStr}&to=${toStr}&bucket=1m`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );

    const res = await getSeriesHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.data.length, 1, 'Harus menghasilkan tepat 1 bucket');

    const bucket = body.data[0];
    assert.strictEqual(bucket.totalCount, 3);

    // Verifikasi Suhu: 20.0 dan 30.0 dengan 1 null
    const temp = bucket.metrics.temperatureC;
    assert.strictEqual(temp.validCount, 2, 'Valid count harus 2');
    assert.strictEqual(temp.invalidCount, 1, 'Invalid count harus 1');
    assert.strictEqual(temp.min, 20.0);
    assert.strictEqual(temp.max, 30.0);
    assert.strictEqual(temp.avg, 25.0, 'Rata-rata HARUS 25.0 (mengabaikan null, BUKAN 16.67)');

    // Verifikasi MQ-136: 500 dan 700 dengan 1 null
    const mq136 = bucket.metrics.mq136Raw;
    assert.strictEqual(mq136.validCount, 2);
    assert.strictEqual(mq136.invalidCount, 1);
    assert.strictEqual(mq136.avg, 600.0, 'Rata-rata MQ-136 harus (500+700)/2 = 600.0');

    // Verifikasi Kelembaban: 60, 70, 80 (semua valid)
    const hum = bucket.metrics.humidityPercent;
    assert.strictEqual(hum.validCount, 3);
    assert.strictEqual(hum.invalidCount, 0);
    assert.strictEqual(hum.avg, 70.0);
  });

  it('2. GET series menolak jika jumlah bucket melebihi batas 1000 (422)', async () => {
    const fromStr = new Date('2026-06-01T00:00:00Z').toISOString();
    const toStr = new Date('2026-08-01T00:00:00Z').toISOString(); // 61 hari

    // Meminta bucket 5 detik untuk rentang 61 hari -> > 1.000.000 bucket
    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/series?from=${fromStr}&to=${toStr}&bucket=5s`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );

    const res = await getSeriesHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 422);

    const body = await res.json();
    assert.strictEqual(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.message.includes('exceeds the maximum limit of 1000 buckets'));
  });

  it('3. Sanitasi Formula Injection CSV (sanitizeCsvCell & buildCsvRow)', () => {
    // Karakter pemicu formula: =, +, -, @, \t, \r
    assert.strictEqual(sanitizeCsvCell('=SUM(A1:A10)'), `'=SUM(A1:A10)`);
    assert.strictEqual(sanitizeCsvCell('=SUM(A1, B1)'), `"'=SUM(A1, B1)"`);
    assert.strictEqual(sanitizeCsvCell('+12345'), `'+12345`);
    // Angka negatif tetap numerik (tidak diubah menjadi teks ber-prefix quote)
    assert.strictEqual(sanitizeCsvCell(-25.5), '-25.5');
    assert.strictEqual(sanitizeCsvCell('-25.5'), '-25.5');
    assert.strictEqual(sanitizeCsvCell('-54321'), '-54321');
    // Formula teks berawalan minus tetap dinetralisir
    assert.strictEqual(sanitizeCsvCell('-SUM(A1:B1)'), `'-SUM(A1:B1)`);
    assert.strictEqual(sanitizeCsvCell('@cmd'), `'@cmd`);
    assert.strictEqual(sanitizeCsvCell('\tmalicious'), `'\tmalicious`);

    // Nilai biasa dan kutipan RFC 4180
    assert.strictEqual(sanitizeCsvCell('Normal Text'), 'Normal Text');
    assert.strictEqual(sanitizeCsvCell('Text with "quotes"'), `"Text with ""quotes"""`);
    assert.strictEqual(sanitizeCsvCell('Text, with, commas'), `"Text, with, commas"`);
    assert.strictEqual(sanitizeCsvCell(null), '');

    const row = buildCsvRow(['esp32-001', '=SUM(1+1)', 25.5]);
    assert.ok(row.includes(`'=SUM(1+1)`));
    assert.ok(row.endsWith('\r\n'));
  });

  it('4. GET /api/v1/chambers/[chamberId]/export streaming file CSV yang valid', async () => {
    const fromStr = new Date(testBaseTime.getTime() - 10000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 10000).toISOString();

    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${fromStr}&to=${toStr}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );

    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const contentType = res.headers.get('content-type');
    assert.ok(contentType?.includes('text/csv'));

    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition?.includes('attachment; filename='));
    assert.ok(disposition?.includes(chamberCode));

    const csvText = await res.text();
    const lines = csvText.trim().split('\r\n');
    assert.ok(lines.length >= 4, 'Header + 3 baris data');

    // Header baris pertama
    assert.ok(lines[0].includes('chamber_code,device_id,message_id,measured_at'));
    // Baris data memuat data sensor
    assert.ok(lines.some((l) => l.includes(deviceMqttId) && l.includes('20')));
    assert.ok(lines.some((l) => l.includes(deviceMqttId) && l.includes('30')));
  });

  it('5. Export CSV menangani pembatalan stream (abort signal) secara bersih', async () => {
    const fromStr = new Date(testBaseTime.getTime() - 10000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 10000).toISOString();

    const abortController = new AbortController();
    abortController.abort(); // Batalkan sebelum stream dimulai

    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${fromStr}&to=${toStr}`,
      {
        method: 'GET',
        headers: { Cookie: adminCookie },
        signal: abortController.signal,
      }
    );

    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    // Membaca stream tidak crash
    const text = await res.text();
    assert.ok(text.length >= 0);
  });

  it('6. Nilai sensor negatif (misal temperatur minus) diekspor sebagai numerik tanpa kutip formula', async () => {
    // Sisipkan reading dengan temperatur negatif (-12.5 °C)
    const negTime = new Date(testBaseTime.getTime() + 5000);
    const negMsgId = `neg-msg-${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      const historySequence = await allocateHistorySequence(tx);
      await tx.sensorReading.create({
        data: {
          deviceId,
          chamberId,
          assignmentId,
          bootId,
          messageId: negMsgId,
          payloadSha256: 'a'.repeat(64),
          measuredAt: negTime,
          receivedAt: negTime,
          measurementTimeQuality: 'SYNCED',
          temperatureC: -12.5,
          temperatureQuality: 'OK',
          humidityPercent: 65.0,
          humidityQuality: 'OK',
          mq137Raw: 200,
          mq137Quality: 'OK',
          mq136Raw: 150,
          mq136Quality: 'OK',
          mq4Raw: 100,
          mq4Quality: 'OK',
          historySequence,
          sequence: historySequence,
          rawPayload: {},
        },
      });
    });

    const fromStr = new Date(testBaseTime.getTime() - 10000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 10000).toISOString();

    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${fromStr}&to=${toStr}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const csvText = await res.text();
    const negLine = csvText.split('\r\n').find((l) => l.includes(negMsgId));
    assert.ok(negLine, 'Baris pembacaan suhu negatif harus ada di CSV');
    assert.ok(negLine.includes(',-12.5,'), 'Nilai suhu negatif harus tetap numerik tanpa kutip');
    assert.ok(!negLine.includes(",'-12.5,"), 'Nilai suhu negatif TIDAK boleh ber-prefix kutip tunggal');
  });

  it('7. CSV konsisten dengan frozen watermark saat data baru/backlog tiba', async () => {
    const fromStr = new Date(testBaseTime.getTime() - 10000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 10000).toISOString();

    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${fromStr}&to=${toStr}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    // Sisipkan reading baru secara atomik setelah snapshot export dibekukan.
    const lateMsgId = `late-backlog-${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      const historySequence = await allocateHistorySequence(tx);
      await tx.sensorReading.create({
        data: {
          deviceId,
          chamberId,
          assignmentId,
          bootId,
          messageId: lateMsgId,
          payloadSha256: 'b'.repeat(64),
          measuredAt: new Date(testBaseTime.getTime() + 1000),
          receivedAt: new Date(),
          measurementTimeQuality: 'SYNCED',
          temperatureC: 28.5,
          temperatureQuality: 'OK',
          humidityPercent: 70.0,
          humidityQuality: 'OK',
          mq137Raw: 220,
          mq137Quality: 'OK',
          mq136Raw: 160,
          mq136Quality: 'OK',
          mq4Raw: 110,
          mq4Quality: 'OK',
          historySequence,
          sequence: historySequence,
          rawPayload: {},
        },
      });
    });

    const csvText = await res.text();
    assert.ok(!csvText.includes(lateMsgId), 'Data dengan sequence di atas snapshot watermark TIDAK boleh bocor ke export');
  });

  it('8. Slow client atau abort di tengah konsumsi menutup stream tanpa error', async () => {
    const fromStr = new Date(testBaseTime.getTime() - 10000).toISOString();
    const toStr = new Date(testBaseTime.getTime() + 10000).toISOString();

    const abortController = new AbortController();
    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${fromStr}&to=${toStr}`,
      { method: 'GET', headers: { Cookie: adminCookie }, signal: abortController.signal }
    );
    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const reader = res.body?.getReader();
    assert.ok(reader);

    // Baca chunk pertama (header)
    const firstChunk = await reader.read();
    assert.ok(!firstChunk.done);
    assert.ok(firstChunk.value.length > 0);

    // Klien lambat/membatalkan koneksi
    abortController.abort();
    await reader.cancel();

    // Pembacaan berikutnya menghasilkan done: true
    const nextChunk = await reader.read();
    assert.ok(nextChunk.done);
  });

  it('9. Timestamp timestamptz round-trip dan filter offset tidak bergeser timezone', async () => {
    const columnTypes = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sensor_readings'
        AND column_name IN ('measured_at', 'received_at')
      ORDER BY column_name;
    `;
    assert.deepStrictEqual(columnTypes, [
      { column_name: 'measured_at', data_type: 'timestamp with time zone' },
      { column_name: 'received_at', data_type: 'timestamp with time zone' },
    ]);

    const measuredAt = new Date('2026-09-16T17:00:00.123+07:00');
    const timestampMsgId = `tz-roundtrip-${Date.now()}`;
    const reading = await prisma.$transaction(async (tx) => {
      const historySequence = await allocateHistorySequence(tx);
      return tx.sensorReading.create({
        data: {
          deviceId,
          chamberId,
          assignmentId,
          bootId,
          messageId: timestampMsgId,
          payloadSha256: 'c'.repeat(64),
          measuredAt,
          receivedAt: measuredAt,
          measurementTimeQuality: 'SYNCED',
          temperatureC: 26.5,
          temperatureQuality: 'OK',
          humidityPercent: 65,
          humidityQuality: 'OK',
          mq137Raw: 200,
          mq137Quality: 'OK',
          mq136Raw: 150,
          mq136Quality: 'OK',
          mq4Raw: 100,
          mq4Quality: 'OK',
          historySequence,
          sequence: historySequence,
          rawPayload: {},
        },
      });
    });

    assert.strictEqual(reading.measuredAt?.toISOString(), '2026-09-16T10:00:00.123Z');
    assert.strictEqual(reading.receivedAt.toISOString(), '2026-09-16T10:00:00.123Z');

    const from = encodeURIComponent('2026-09-16T16:59:59.999+07:00');
    const to = encodeURIComponent('2026-09-16T17:00:00.124+07:00');
    const req = new Request(
      `http://localhost:3000/api/v1/chambers/${chamberCode}/export?from=${from}&to=${to}`,
      { method: 'GET', headers: { Cookie: adminCookie } }
    );
    const res = await getExportHandler(req, { params: Promise.resolve({ chamberId: chamberCode }) });
    assert.strictEqual(res.status, 200);

    const csvText = await res.text();
    const timestampLine = csvText.split('\r\n').find((line) => line.includes(timestampMsgId));
    assert.ok(timestampLine, 'Filter offset +07:00 harus menemukan instant UTC yang sama');
    assert.ok(
      timestampLine.includes('2026-09-16T10:00:00.123Z'),
      'Timestamp hasil export harus kembali sebagai instant UTC yang sama'
    );
  });
});
