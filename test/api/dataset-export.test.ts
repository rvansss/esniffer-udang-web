import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { GET as exportBatch } from '../../app/api/v1/batches/[batchId]/export/route.ts';
import { GET as exportSession } from '../../app/api/v1/sessions/[sessionId]/export/route.ts';
import { DATASET_CSV_HEADERS, DATASET_METADATA_CSV_HEADERS, SESSION_READINGS_CSV_HEADERS, CSV_UTF8_BOM } from '../../lib/api/csv.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const runId = randomUUID().slice(0, 8);
const BATCH = 'BT-20990606-01';
const GROUP = `${BATCH}-SR`;
const SESSION = `SES-20990606-H0-SR`;

let viewerCookie = '';
let deviceId = '';
let chamberId = '';
let assignmentId = '';
let sessionUuid = '';
const userIds: string[] = [];

async function makeReading(tag: string, measuredAt: Date, baseline: boolean, nullMq136: boolean) {
  return prisma.sensorReading.create({
    data: {
      deviceId,
      chamberId,
      assignmentId,
      historySequence: await allocateHistorySequence(),
      messageId: `${tag}-${runId}`,
      payloadSha256: `${tag}${runId}`.padEnd(64, '0').slice(0, 64),
      bootId: randomUUID(),
      sequence: BigInt(Math.floor(Math.random() * 1_000_000)),
      measuredAt,
      measurementTimeQuality: 'SYNCED',
      temperatureC: 25.3,
      temperatureQuality: 'OK',
      humidityPercent: 68.5,
      humidityQuality: 'OK',
      mq137Raw: 1.842,
      mq137Quality: 'OK',
      mq136Raw: nullMq136 ? null : 0.915,
      mq136Quality: nullMq136 ? 'SENSOR_ERROR' : 'OK',
      mq4Raw: 1.103,
      mq4Quality: 'OK',
      rawPayload: { test: true },
      sessionId: sessionUuid,
      batchId: BATCH,
      timepointCode: 'H0',
      isBaseline: baseline,
    },
  });
}

function getExport(query = '') {
  return exportBatch(
    new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export${query}`, {
      headers: { Cookie: viewerCookie },
    }),
    { params: Promise.resolve({ batchId: BATCH }) }
  );
}

describe('HTTP API v1: Dataset Batch CSV Export (Fase 7)', () => {
  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `export-admin-${runId}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    const viewer = await prisma.user.create({
      data: { email: `export-viewer-${runId}@esniffer.local`, passwordHash, role: 'VIEWER', isActive: true },
    });
    userIds.push(admin.id, viewer.id);
    const v = await createAuthSession(viewer.id);
    viewerCookie = buildSessionCookie(v.rawToken, v.expiresAt).split(';')[0];

    const device = await prisma.device.create({
      data: { mqttDeviceId: `export-${runId}`, name: 'Export Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `EXP-${runId}`, name: 'Export Chamber' },
    });
    chamberId = chamber.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceId, chamberId, activeFrom: new Date('2099-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;

    await prisma.collectionBatch.create({
      data: {
        batchId: BATCH,
        procuredAtUtc: new Date('2099-06-06T00:30:00.000Z'),
        marketSource: 'Pasar Export',
        sourceType: 'MARKET',
        shrimpCount: 12,
        // Langsung via Prisma (melewati API): isi turunan manual sesuai rumus server.
        sizeGrade: 25, // Math.round(12 / 485.5 * 1000)
        shrimpLengthCm: 12.5,
        totalWeightG: 485.5,
        initialCondition: 'DEAD',
        initialTempC: 8.2,
        arrivedAtUtc: new Date('2099-06-06T02:00:00.000Z'),
        coolerTempMarketC: 1.2,
        coolerTempLabC: 3.8,
        operatorId: admin.id,
      },
    });
    await prisma.sampleGroup.create({
      data: {
        groupId: GROUP,
        batchId: BATCH,
        chamberId,
        storageCondition: 'ROOM_TEMP',
        targetTempC: 25.0,
        labTempC: 6.5,
        visualCheck: 'NORMAL',
        labWeightBeforeG: 482.0,
        labWeightAfterG: 478.5,
        sampleShrimpCount: 4,
      },
    });
    // Grup dingin tanpa sesi — menguji baris 'no_session' pada metadata.
    await prisma.sampleGroup.create({
      data: {
        groupId: `${BATCH}-SD`,
        batchId: BATCH,
        storageCondition: 'COLD',
        targetTempC: 4.0,
        labTempC: 5.0,
        visualCheck: 'NORMAL',
        labWeightBeforeG: 480.0,
        labWeightAfterG: 476.2,
        sampleShrimpCount: 4,
      },
    });
    const session = await prisma.measurementSession.create({
      data: {
        sessionId: SESSION,
        groupId: GROUP,
        batchId: BATCH,
        chamberId,
        deviceId,
        timepointCode: 'H0',
        elapsedHours: 0,
        startedAtUtc: new Date('2099-06-06T06:00:00.000Z'),
        endedAtUtc: new Date('2099-06-06T06:15:00.000Z'),
        warmupDone: true,
        cleaningDone: true,
        status: 'COMPLETE',
      },
    });
    sessionUuid = session.id;

    await makeReading('exp-base', new Date('2099-06-06T06:00:30.000Z'), true, false);
    await makeReading('exp-null', new Date('2099-06-06T06:01:00.000Z'), true, true);
    await makeReading('exp-sample', new Date('2099-06-06T06:05:00.000Z'), false, false);
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { id: sessionUuid } });
    await prisma.sampleGroup.deleteMany({ where: { batchId: BATCH } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: BATCH } });
    await prisma.deviceAssignment.deleteMany({ where: { id: assignmentId } });
    await prisma.collectionBatch.deleteMany({ where: { batchId: 'BT-20990606-02' } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await closeDb();
  });

  it('1. Export menghasilkan header dasar PRD, timestamp WIB, dan row ML-ready', async () => {
    const res = await getExport();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`dataset-${BATCH}\\.csv`));

    const clone = res.clone();
    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines[0], DATASET_CSV_HEADERS.join(','));
    assert.strictEqual(lines.length, 4); // header + 3 row
    // BOM diverifikasi di level byte (res.text() menghapus BOM sesuai standar Encoding)
    const headBytes = new Uint8Array(await clone.arrayBuffer()).slice(0, 3);
    assert.deepStrictEqual([...headBytes], [0xef, 0xbb, 0xbf]);

    const base = lines[1].split(',');
    assert.strictEqual(base.length, DATASET_CSV_HEADERS.length);
    assert.strictEqual(
      base[DATASET_CSV_HEADERS.indexOf('timestamp_wib')],
      '2099-06-06T13:00:30.000+07:00'
    );
    assert.strictEqual(base[0], '2099-06-06T06:00:30.000Z');
    assert.strictEqual(base[1], SESSION);
    assert.strictEqual(base[2], BATCH);
    assert.strictEqual(base[3], 'market');
    assert.strictEqual(base[4], 'room_temp');
    assert.strictEqual(base[5], 'H0');
    assert.strictEqual(base[6], '0');
    assert.strictEqual(base[7], '1.842');
    assert.strictEqual(base[12], 'true');

    const nullRow = lines[2].split(',');
    assert.strictEqual(nullRow[8], ''); // mq136 null → sel kosong, bukan 0
    assert.strictEqual(nullRow[12], 'true');

    const sampleRow = lines[3].split(',');
    assert.strictEqual(sampleRow[12], 'false');
  });

  it('2. Filter sessionId, timepointCode, dan isBaseline', async () => {
    const bySession = await getExport(`?sessionId=${SESSION}`);
    assert.strictEqual((await bySession.text()).split('\r\n').filter((l) => l.length > 0).length, 4);

    const byTimepoint = await getExport('?timepointCode=H0');
    assert.strictEqual((await byTimepoint.text()).split('\r\n').filter((l) => l.length > 0).length, 4);

    const baselineOnly = await getExport('?isBaseline=true');
    assert.strictEqual((await baselineOnly.text()).split('\r\n').filter((l) => l.length > 0).length, 3);

    const badFlag = await exportBatch(
      new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export?isBaseline=mungkin`, {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ batchId: BATCH }) }
    );
    assert.strictEqual(badFlag.status, 422);

    const unknownSession = await getExport('?sessionId=SES-TIDAK-ADA');
    assert.strictEqual(unknownSession.status, 404);
  });

  it('3. Batch tidak ada 404, tanpa auth 401', async () => {
    const missing = await exportBatch(
      new Request('http://localhost:3000/api/v1/batches/BT-20990606-99/export', {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ batchId: 'BT-20990606-99' }) }
    );
    assert.strictEqual(missing.status, 404);

    const anon = await exportBatch(
      new Request(`http://localhost:3000/api/v1/batches/${BATCH}/export`),
      { params: Promise.resolve({ batchId: BATCH }) }
    );
    assert.strictEqual(anon.status, 401);
  });

  it('4. format=metadata membawa isian form (satu baris per sesi + no_session)', async () => {
    const res = await getExport('?format=metadata');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /metadata-.*\.csv/);
    const clone = res.clone();
    const metaText = await res.text();
    assert.ok(!metaText.startsWith(CSV_UTF8_BOM), 'BOM hanya di level byte, bukan teks terurai');
    const headBytes = new Uint8Array(await clone.arrayBuffer()).slice(0, 3);
    assert.deepStrictEqual([...headBytes], [0xef, 0xbb, 0xbf], 'Metadata wajib diawali BOM UTF-8');
    const lines = metaText.split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines[0].split(',')[0], 'batch_id');
    const headers = lines[0].split(',');
    // Indeks dicari dari header, bukan angka mati: penambahan kolom baru
    // (keberangkatan) tidak boleh membuat test rapuh.
    const col = (name: string): number => headers.indexOf(name);
    assert.ok(headers.includes('departed_date') && headers.includes('departed_time_wib'));
    assert.ok(headers.includes('cooler_temp_departure_c'), 'revisi: suhu saat berangkat');
    assert.ok(headers.includes('procured_date'), 'butir 5: kolom tanggal beli');
    assert.ok(headers.includes('procured_time_wib'), 'butir 5: kolom jam beli WIB');
    assert.ok(headers.includes('arrived_date') && headers.includes('arrived_time_wib'));
    assert.ok(headers.includes('cooler_temp_market_c'), 'butir 7: suhu saat di pasar');
    assert.ok(headers.includes('cooler_temp_lab_c'), 'butir 7: suhu saat di lab');
    assert.ok(!headers.includes('procured_at_utc'), 'kolom ISO lama sudah tidak ada');
    assert.ok(!headers.includes('cooler_temp_min_c'), 'header min/max lama sudah tidak ada');
    assert.strictEqual(lines.length, 3); // header + SR (punya sesi) + SD (no_session)

    const sr = lines.find((l) => l.includes(GROUP))!.split(',');
    assert.strictEqual(sr[col('batch_id')], BATCH);
    assert.strictEqual(sr[col('procured_date')], '2099-06-06'); // UTC+7 dari 00:30Z
    assert.strictEqual(sr[col('procured_time_wib')], '07:30:00');
    assert.strictEqual(sr[col('market_source')], 'Pasar Export');
    assert.strictEqual(sr[col('shrimp_length_cm')], '12.5');
    assert.strictEqual(sr[col('total_weight_g')], '485.5');
    assert.strictEqual(sr[col('arrived_date')], '2099-06-06');
    assert.strictEqual(sr[col('arrived_time_wib')], '09:00:00');
    // Baris lama tanpa keberangkatan: sel dikosongkan, bukan diisi nilai karangan.
    assert.strictEqual(sr[col('departed_date')], '');
    assert.strictEqual(sr[col('departed_time_wib')], '');
    assert.strictEqual(sr[col('cooler_temp_departure_c')], '');
    assert.strictEqual(sr[col('cooler_temp_market_c')], '1.2');
    assert.strictEqual(sr[col('cooler_temp_lab_c')], '3.8');
    assert.strictEqual(sr[col('group_id')], GROUP);
    assert.strictEqual(sr[col('storage_condition')], 'room_temp');
    assert.strictEqual(sr[col('lab_weight_before_g')], '482');
    assert.strictEqual(sr[col('lab_weight_after_g')], '478.5');
    assert.strictEqual(sr[col('sample_shrimp_count')], '4');
    assert.strictEqual(sr[col('session_id')], SESSION);
    assert.strictEqual(sr[col('elapsed_hours')], '0');
    assert.strictEqual(sr[col('session_status')], 'complete');
    assert.strictEqual(sr[col('warmup_done')], 'true');
    assert.strictEqual(sr.length, headers.length);
    assert.strictEqual(sr[col('started_at_wib')], '2099-06-06T13:00:00.000+07:00');
    assert.strictEqual(new Date(sr[col('ended_at_wib')]).getTime(), new Date(sr[col('ended_at_utc')]).getTime());

    const sd = lines.find((l) => l.includes(`${BATCH}-SD`))!.split(',');
    assert.strictEqual(sd.length, headers.length);
    assert.strictEqual(sd[col('started_at_wib')], '');
    assert.strictEqual(sd[col('ended_at_wib')], '');
    assert.strictEqual(sd[col('group_id')], `${BATCH}-SD`);
    assert.strictEqual(sd[col('storage_condition')], 'cold');
    assert.strictEqual(sd[col('lab_weight_after_g')], '476.2');
    assert.strictEqual(sd[col('session_id')], '');
    assert.strictEqual(sd[col('session_status')], 'no_session');
  });

  it('4b. metadata batch tanpa grup: semua baris selebar header', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: `export-admin-${runId}@esniffer.local` },
    });
    await prisma.collectionBatch.create({
      data: {
        batchId: 'BT-20990606-02',
        departedAtUtc: new Date('2099-06-06T00:00:00.000Z'), // 07:00 WIB
        procuredAtUtc: new Date('2099-06-06T00:30:00.000Z'),
        marketSource: 'Pasar Export',
        sourceType: 'MARKET',
        shrimpCount: 12,
        sizeGrade: 25,
        shrimpLengthCm: 12.5,
        totalWeightG: 485.5,
        initialCondition: 'DEAD',
        initialTempC: 8.2,
        arrivedAtUtc: new Date('2099-06-06T02:00:00.000Z'),
        coolerTempDepartureC: 1.0,
        coolerTempMarketC: 1.2,
        coolerTempLabC: 3.8,
        operatorId: admin.id,
      },
    });
    const res = await exportBatch(
      new Request('http://localhost:3000/api/v1/batches/BT-20990606-02/export?format=metadata', {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ batchId: 'BT-20990606-02' }) }
    );
    assert.strictEqual(res.status, 200);
    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines.length, 2); // header + 1 baris tanpa grup
    const width = DATASET_METADATA_CSV_HEADERS.length;
    for (const line of lines) {
      assert.strictEqual(line.split(',').length, width);
    }
    assert.ok(lines[1].includes('no_session'));

    const headers = lines[0].split(',');
    const row = lines[1].split(',');
    assert.strictEqual(row[headers.indexOf('departed_date')], '2099-06-06');
    assert.strictEqual(row[headers.indexOf('departed_time_wib')], '07:00:00');
    assert.strictEqual(row[headers.indexOf('cooler_temp_departure_c')], '1');
  });

  it('5. format tidak dikenal ditolak 422', async () => {
    const res = await getExport('?format=pdf');
    assert.strictEqual(res.status, 422);
  });

  it('6. Ekspor CSV per sesi menghasilkan header, format RFC 4180, dan row telemetri', async () => {
    const res = await exportSession(
      new Request(`http://localhost:3000/api/v1/sessions/${SESSION}/export`, {
        headers: { Cookie: viewerCookie },
      }),
      { params: Promise.resolve({ sessionId: SESSION }) }
    );
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.strictEqual(
      res.headers.get('Content-Disposition'),
      `attachment; filename="hasil-${SESSION}.csv"`
    );

    const clone = res.clone();
    const headBytes = new Uint8Array(await clone.arrayBuffer()).slice(0, 3);
    assert.deepStrictEqual([...headBytes], [0xef, 0xbb, 0xbf]);

    const text = await res.text();
    const lines = text.split('\r\n').filter((l) => l.length > 0);
    assert.ok(lines.length >= 2); // header + minimal 1 data row

    const headerCols = lines[0].split(',');
    assert.deepStrictEqual(headerCols, SESSION_READINGS_CSV_HEADERS);

    const firstData = lines[1].split(',');
    assert.strictEqual(firstData[headerCols.indexOf('session_id')], SESSION);
    assert.strictEqual(firstData[headerCols.indexOf('batch_id')], BATCH);
    assert.strictEqual(firstData[headerCols.indexOf('timepoint_code')], 'H0');
  });
});
