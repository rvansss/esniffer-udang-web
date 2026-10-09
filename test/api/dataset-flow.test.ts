/**
 * End-to-end feature flow (Fase 8): satu batch lengkap dari pembuatan
 * sampai export CSV ML-ready, dijalankan lintas Route Handler + backfill.
 *
 * Memverifikasi kriteria sukses PRD §1 yang dapat diuji otomatis:
 *  #1 0 kolom konteks null pada export (batch_id/session_id/timepoint_code/is_baseline)
 *  #2 cold-chain >3 jam ditolak otomatis tanpa acknowledgement
 *  #4 0 duplikat timepoint per grup
 *  #5 split baseline (2 menit) vs sampel benar
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { POST as createBatch } from '../../app/api/v1/batches/route.ts';
import { POST as createGroups } from '../../app/api/v1/batches/[batchId]/groups/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { POST as completeSession } from '../../app/api/v1/sessions/[sessionId]/complete/route.ts';
import { POST as lockBatch } from '../../app/api/v1/batches/[batchId]/lock/route.ts';
import { GET as exportBatch } from '../../app/api/v1/batches/[batchId]/export/route.ts';
import { DATASET_CSV_HEADERS } from '../../lib/api/csv.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { createSession as createAuthSession, buildSessionCookie } from '../../lib/auth/session.ts';

const runId = randomUUID().slice(0, 8);
const DAY = '2099-07-07';
const START = new Date('2099-07-07T06:00:00.000Z');
const END = new Date('2099-07-07T06:15:00.000Z');
const BASELINE_ROWS = 120;
const SAMPLE_ROWS = 60;

let adminCookie = '';
let adminUserId = '';
let deviceId = '';
let chamberId = '';
let assignmentId = '';
let batchId = '';
let groupSr = '';
let sessionH0 = '';
let sessionH6 = '';

function post(cookie: string, url: string, payload: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:3000',
      Host: 'localhost:3000',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function injectReadings(start: Date, secondsFromStart: number, count: number, tag: string) {
  for (let i = 0; i < count; i += 1) {
    const measuredAt = new Date(start.getTime() + (secondsFromStart + i) * 1000);
    await prisma.sensorReading.create({
      data: {
        deviceId,
        chamberId,
        assignmentId,
        historySequence: await allocateHistorySequence(),
        messageId: `${tag}-${runId}-${i}`,
        payloadSha256: `${tag}${runId}${i}`.padEnd(64, '0').slice(0, 64),
        bootId: randomUUID(),
        sequence: BigInt(secondsFromStart + i),
        measuredAt,
        measurementTimeQuality: 'SYNCED',
        temperatureC: 25.3,
        temperatureQuality: 'OK',
        humidityPercent: 68.5,
        humidityQuality: 'OK',
        mq137Raw: 1.842,
        mq137Quality: 'OK',
        mq136Raw: 0.915,
        mq136Quality: 'OK',
        mq4Raw: 1.103,
        mq4Quality: 'OK',
        rawPayload: { test: true },
      },
    });
  }
}

describe('Dataset Feature End-to-End Flow (Fase 8)', () => {
  before(async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await prisma.user.create({
      data: { email: `flow-${runId}@esniffer.local`, passwordHash, role: 'ADMIN', isActive: true },
    });
    adminUserId = admin.id;
    const s = await createAuthSession(admin.id);
    adminCookie = buildSessionCookie(s.rawToken, s.expiresAt).split(';')[0];

    const device = await prisma.device.create({
      data: { mqttDeviceId: `flow-${runId}`, name: 'Flow Node' },
    });
    deviceId = device.id;
    const chamber = await prisma.chamber.create({
      data: { code: `FLW-${runId}`, name: 'Flow Chamber' },
    });
    chamberId = chamber.id;
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceId, chamberId, activeFrom: new Date('2099-01-01T00:00:00.000Z') },
    });
    assignmentId = assignment.id;
  });

  after(async () => {
    await prisma.sensorReading.deleteMany({ where: { deviceId } });
    await prisma.measurementSession.deleteMany({ where: { batchId } });
    await prisma.sampleGroup.deleteMany({ where: { batchId } });
    await prisma.collectionBatch.deleteMany({ where: { batchId } });
    await prisma.deviceAssignment.deleteMany({ where: { id: assignmentId } });
    await prisma.device.deleteMany({ where: { id: deviceId } });
    await prisma.chamber.deleteMany({ where: { id: chamberId } });
    await prisma.authSession.deleteMany({ where: { userId: adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await closeDb();
  });

  it('kriteria #2: batch cold-chain >3 jam ditolak tanpa acknowledgement', async () => {
    const res = await createBatch(
      post(adminCookie, 'http://localhost:3000/api/v1/batches', {
        procuredAtUtc: `${DAY}T00:30:00.000Z`,
        marketSource: 'Pasar Flow',
        sourceType: 'market',
        shrimpCount: 12,
        sizeGrade: 60,
        totalWeightG: 485.5,
        initialCondition: 'fresh_dead',
        initialTempC: 8.2,
        departedAtUtc: `${DAY}T00:15:00.000Z`,
        arrivedAtUtc: `${DAY}T05:00:00.000Z`, // ~4h45m
        coolerTempMinC: 1.2,
        coolerTempMaxC: 3.8,
        tempStartC: 3.0,
        tempEndC: 3.5,
      })
    );
    assert.strictEqual(res.status, 422);
  });

  it('membuat batch + 2 grup + sesi H0 dengan split baseline/sampel benar', async () => {
    const batchRes = await createBatch(
      post(adminCookie, 'http://localhost:3000/api/v1/batches', {
        procuredAtUtc: `${DAY}T00:30:00.000Z`,
        marketSource: 'Pasar Flow',
        sourceType: 'market',
        shrimpCount: 12,
        sizeGrade: 60,
        totalWeightG: 485.5,
        initialCondition: 'fresh_dead',
        initialTempC: 8.2,
        departedAtUtc: `${DAY}T00:15:00.000Z`,
        arrivedAtUtc: `${DAY}T02:00:00.000Z`,
        coolerTempMinC: 1.2,
        coolerTempMaxC: 3.8,
        tempStartC: 3.0,
        tempEndC: 3.5,
      })
    );
    assert.strictEqual(batchRes.status, 201);
    batchId = (await batchRes.json()).data.batchId;
    assert.match(batchId, /^BT-\d{8}-\d{2}$/);

    const groupRes = await createGroups(
      post(adminCookie, `http://localhost:3000/api/v1/batches/${batchId}/groups`, {
        groups: [
          { storageCondition: 'room_temp', labTempC: 6.5, visualCheck: 'normal', labWeightG: 482, sampleShrimpCount: 4, sampleWeightG: 162.3 },
          { storageCondition: 'cold', labTempC: 5.0, visualCheck: 'normal', labWeightG: 480, sampleShrimpCount: 4, sampleWeightG: 160 },
        ],
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(groupRes.status, 201);
    groupSr = `${batchId}-SR`;

    const sessionRes = await createSession(
      post(adminCookie, `http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        timepointCode: 'H0',
        warmupDone: true,
        startedAtUtc: START.toISOString(),
        chamberId,
        deviceId,
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(sessionRes.status, 201);
    sessionH0 = (await sessionRes.json()).data.sessionId;

    // 120 baseline (2 menit pertama) + 60 sampel
    await injectReadings(START, 0, BASELINE_ROWS, 'flow-base');
    await injectReadings(START, BASELINE_ROWS, SAMPLE_ROWS, 'flow-sample');

    const done = await completeSession(
      post(adminCookie, `http://localhost:3000/api/v1/sessions/${sessionH0}/complete`, {
        cleaningDone: true,
        endedAtUtc: END.toISOString(),
      }),
      { params: Promise.resolve({ sessionId: sessionH0 }) }
    );
    assert.strictEqual(done.status, 200);
    const meta = (await done.json()).meta as { linkedReadings: number; baselineReadings: number };
    assert.strictEqual(meta.linkedReadings, BASELINE_ROWS + SAMPLE_ROWS);
    assert.strictEqual(meta.baselineReadings, BASELINE_ROWS); // kriteria #5
  });

  it('kriteria #4: timepoint duplikat/mundur ditolak 409', async () => {
    const dup = await createSession(
      post(adminCookie, `http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        timepointCode: 'H0',
        warmupDone: true,
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(dup.status, 409);
  });

  it('kriteria #1: export seluruh batch tanpa kolom konteks null', async () => {
    // Sesi H6 untuk melengkapi rangkaian timepoint
    const h6 = await createSession(
      post(adminCookie, `http://localhost:3000/api/v1/groups/${groupSr}/sessions`, {
        timepointCode: 'H6',
        warmupDone: true,
        startedAtUtc: new Date(START.getTime() + 6 * 3_600_000).toISOString(),
        chamberId,
        deviceId,
      }),
      { params: Promise.resolve({ groupId: groupSr }) }
    );
    assert.strictEqual(h6.status, 201);
    sessionH6 = (await h6.json()).data.sessionId;
    await injectReadings(new Date(START.getTime() + 6 * 3_600_000), 180, 10, 'flow-h6');
    await completeSession(
      post(adminCookie, `http://localhost:3000/api/v1/sessions/${sessionH6}/complete`, {
        cleaningDone: true,
        endedAtUtc: new Date(START.getTime() + 6.25 * 3_600_000).toISOString(),
      }),
      { params: Promise.resolve({ sessionId: sessionH6 }) }
    );

    // Lock butuh foto
    await prisma.collectionBatch.update({
      where: { batchId },
      data: { photoUrls: [`uploads/${batchId}/flow.jpg`] },
    });
    const locked = await lockBatch(
      post(adminCookie, `http://localhost:3000/api/v1/batches/${batchId}/lock`, {}),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(locked.status, 200);

    const exp = await exportBatch(
      new Request(`http://localhost:3000/api/v1/batches/${batchId}/export`, {
        headers: { Cookie: adminCookie },
      }),
      { params: Promise.resolve({ batchId }) }
    );
    assert.strictEqual(exp.status, 200);

    const lines = (await exp.text()).split('\r\n').filter((l) => l.length > 0);
    assert.strictEqual(lines[0], DATASET_CSV_HEADERS.join(','));
    const rows = lines.slice(1);
    assert.strictEqual(rows.length, BASELINE_ROWS + SAMPLE_ROWS + 10);

    // Indeks kolom konteks: session_id(1), batch_id(2), timepoint_code(5), is_baseline(12)
    for (const row of rows) {
      const cells = row.split(',');
      assert.ok(cells[1].length > 0, 'session_id tidak boleh kosong');
      assert.strictEqual(cells[2], batchId);
      assert.ok(cells[5].length > 0, 'timepoint_code tidak boleh kosong');
      assert.ok(cells[12] === 'true' || cells[12] === 'false', 'is_baseline harus boolean');
    }
    const baselineCount = rows.filter((r) => r.split(',')[12] === 'true').length;
    assert.strictEqual(baselineCount, BASELINE_ROWS);
  });
});
