import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma, closeDb, allocateHistorySequence } from '../../lib/db/client.ts';
import { createSession as authSession, buildSessionCookie } from '../../lib/auth/session.ts';
import { POST as createBatch } from '../../app/api/v1/batches/route.ts';
import { GET as batchDetail, PATCH as patchBatch } from '../../app/api/v1/batches/[batchId]/route.ts';
import { POST as createSession } from '../../app/api/v1/groups/[groupId]/sessions/route.ts';
import { GET as exportBatch } from '../../app/api/v1/batches/[batchId]/export/route.ts';
import { POST as createGroups } from '../../app/api/v1/batches/[batchId]/groups/route.ts';
import { backfillSessionReadings } from '../../lib/dataset/backfill.ts';
import { ML_CSV_HEADERS } from '../../lib/dataset/quality.ts';
import { seedCalibration } from '../helpers/calibration.ts';

const tag = randomUUID().slice(0, 8);
let assignmentId = ''; let referenceId = '';
let userId = ''; let chamberId = ''; let deviceId = ''; let cookie = ''; let batchId = ''; let sessionId = '';
const payload = {
  departedAtUtc: '2099-11-05T00:00:00Z', procuredAtUtc: '2099-11-05T00:15:00Z', arrivedAtUtc: '2099-11-05T00:45:00Z',
  marketSource: 'Pasar kualitas', sourceType: 'market', shrimpType: 'vaname', shrimpCount: 12, shrimpLengthCm: 12.5,
  totalWeightG: 480, initialCondition: 'dead', initialTempC: 2, coolerTempDepartureC: 1, coolerTempMarketC: 2, coolerTempLabC: 3,
  grouping: { visualCheck: 'normal', sampleShrimpCount: 4 },
};
function request(path: string, body?: unknown, method = 'POST') {
  return new Request(`http://localhost:3000/api/v1/${path}`, { method, headers: { Cookie: cookie, Origin: 'http://localhost:3000', Host: 'localhost:3000', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const ctx = () => ({ params: Promise.resolve({ batchId }) });
before(async () => {
  const user = await prisma.user.create({ data: { email: `quality-${tag}@test.local`, passwordHash: 'unused', role: 'ADMIN' } }); userId = user.id;
  const auth = await authSession(userId); cookie = buildSessionCookie(auth.rawToken, auth.expiresAt).split(';')[0];
  const chamber = await prisma.chamber.create({ data: { code: `Q-${tag}`, name: 'Quality chamber' } }); chamberId = chamber.id;
  const device = await prisma.device.create({ data: { mqttDeviceId: `quality-${tag}`, name: 'Quality device' } }); deviceId = device.id;
  assignmentId = (await prisma.deviceAssignment.create({ data: { chamberId, deviceId, activeFrom: new Date('2000-01-01T00:00:00Z') } })).id;
  referenceId = (await prisma.deviceTimeReference.create({ data: { deviceId, bootId: randomUUID(), referenceKey: tag, anchorUtc: new Date(), anchorUptimeMs: 0n, uncertaintyMs: 1, source: 'NTP' } })).id;
});
after(async () => {
  const batches = await prisma.collectionBatch.findMany({ where: { operatorId: userId }, select: { batchId: true } });
  const ids = batches.map((b) => b.batchId);
  await prisma.sensorReading.deleteMany({ where: { deviceId } });
  await prisma.measurementSession.deleteMany({ where: { batchId: { in: ids } } });
  await prisma.sampleGroup.deleteMany({ where: { batchId: { in: ids } } });
  await prisma.collectionBatch.deleteMany({ where: { operatorId: userId } });
  await prisma.deviceAssignment.deleteMany({ where: { deviceId } });
  await prisma.deviceTimeReference.deleteMany({ where: { deviceId } });
  await prisma.device.delete({ where: { id: deviceId } }); await prisma.chamber.delete({ where: { id: chamberId } });
  await prisma.user.delete({ where: { id: userId } }); await closeDb();
});
test('invalid grouping or shrimp type leaves no partial batch behind', async () => {
  const before = await prisma.collectionBatch.count({ where: { operatorId: userId } });
  for (const changed of [{ shrimpType: '' }, { shrimpType: 'unknown' }, { totalWeightG: 480.123 }, { shrimpCount: 1e30 }, { grouping: { ...payload.grouping, sampleShrimpCount: 0 } }]) {
    const result = await createBatch(request('batches', { ...payload, ...changed }));
    assert.equal(result.status, 422);
  }
  assert.equal(await prisma.collectionBatch.count({ where: { operatorId: userId } }), before);
});
test('one save creates typed batch and both neutral-input groups with no manufactured measurements', async () => {
  const result = await createBatch(request('batches', payload)); assert.equal(result.status, 201);
  batchId = (await result.json()).data.batchId;
  // Kedua grup butuh kalibrasi selesai di server sebelum sesi live (Fase 0).
  await seedCalibration(batchId, `${batchId}-SR`);
  await seedCalibration(batchId, `${batchId}-SD`);
  const detail = await batchDetail(request(`batches/${batchId}`, undefined, 'GET'), ctx());
  const data = (await detail.json()).data;
  assert.equal(data.shrimpType, 'vaname'); assert.equal(data.sampleGroups.length, 2);
  assert.deepEqual(data.sampleGroups.map((g: { storageCondition: string }) => g.storageCondition).sort(), ['cold', 'room_temp']);
  for (const group of data.sampleGroups) { assert.equal(group.labTempC, null); assert.equal(group.labWeightBeforeG, null); assert.equal(group.labWeightAfterG, null); assert.equal(group.coldStorageMode, 'chamber'); assert.equal(group.sampleShrimpCount, 4); }
});
test('partial grouping edits preserve old differences and old measurements', async () => {
  await prisma.sampleGroup.update({ where: { groupId: `${batchId}-SD` }, data: { visualCheck: 'MELANOSIS', labTempC: 7, labWeightBeforeG: 480 } });
  assert.equal((await patchBatch(request(`batches/${batchId}`, { grouping: { sampleShrimpCount: null } }, 'PATCH'), ctx())).status, 422);
  const result = await patchBatch(request(`batches/${batchId}`, { grouping: { sampleShrimpCount: 5 } }, 'PATCH'), ctx());
  assert.equal(result.status, 200);
  const groups = await prisma.sampleGroup.findMany({ where: { batchId }, orderBy: { groupId: 'asc' } });
  assert.equal(new Set(groups.map((g) => g.visualCheck)).size, 2);
  assert.ok(groups.every((g) => g.sampleShrimpCount === 5));
  assert.equal(groups.find((g) => g.storageCondition === 'COLD')!.labTempC!.toNumber(), 7);
});
test('new groups reject plain-fridge mode', async () => {
  const result = await createGroups(request(`batches/${batchId}/groups`, { groups: [{ storageCondition: 'cold', ...payload.grouping, coldStorageMode: 'plain_fridge' }] }), ctx());
  assert.equal(result.status, 422);
});
test('sessions require independent measurements and exactly one concurrent chamber acquisition wins', async () => {
  const groupId = `${batchId}-SR`;
  const body = { timepointCode: 'H0', chamberId, startedAtUtc: '2099-11-05T01:00:00Z', durationSeconds: 300, warmupDone: true, shrimpTempC: 5, shrimpWeightG: 450 };
  const missing = await createSession(request(`groups/${groupId}/sessions`, { ...body, shrimpTempC: undefined }), { params: Promise.resolve({ groupId }) });
  assert.equal(missing.status, 422);
  const responses = await Promise.all(['SR', 'SD'].map((suffix) => {
    const groupId = `${batchId}-${suffix}`;
    return createSession(request(`groups/${groupId}/sessions`, body), { params: Promise.resolve({ groupId }) });
  }));
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const success = await responses.find((r) => r.status === 201)!.json(); sessionId = success.data.id;
  assert.equal(success.data.shrimpWeightG, 450);
});
async function addReading(seconds: number, overrides: Record<string, unknown> = {}) {
  const session = await prisma.measurementSession.findUniqueOrThrow({ where: { id: sessionId } });
  return prisma.sensorReading.create({ data: {
    deviceId, chamberId, assignmentId, messageId: `${tag}-${randomUUID()}`, payloadSha256: 'a'.repeat(64), bootId: randomUUID(), sequence: BigInt(seconds), historySequence: await allocateHistorySequence(),
    measuredAt: new Date(session.startedAtUtc.getTime() + seconds * 1000), measurementTimeQuality: 'SYNCED',
    temperatureC: 25, temperatureQuality: 'OK', humidityPercent: 60, humidityQuality: 'OK',
    mq137Raw: 0, mq137Quality: 'OK', mq136Raw: 20, mq136Quality: 'OK', mq4Raw: 30, mq4Quality: 'OK', rawPayload: {},
    ...overrides,
  } });
}
test('half-open linking and baseline aggregates exclude invalid values and reset missing channels to null', async () => {
  await prisma.measurementSession.update({ where: { id: sessionId }, data: { endedAtUtc: new Date('2099-11-05T01:05:00Z') } });
  await addReading(0); await addReading(60, { mq137Raw: null, mq137Quality: 'OUT_OF_RANGE' });
  await addReading(120); await addReading(121, { mq136Raw: null, mq136Quality: 'SENSOR_ERROR' });
  await addReading(122, { measurementTimeQuality: 'RECONSTRUCTED', timeReferenceId: referenceId, timeUncertaintyMs: 1 });
  const endpoint = await addReading(300);
  const linked = await backfillSessionReadings(sessionId); assert.equal(linked.linked, 5); assert.equal(linked.baseline, 2);
  assert.equal((await prisma.sensorReading.findUniqueOrThrow({ where: { id: endpoint.id } })).sessionId, null);
  const s = await prisma.measurementSession.findUniqueOrThrow({ where: { id: sessionId } }); assert.equal(s.baselineMq137!.toNumber(), 0);
  assert.equal((await backfillSessionReadings(sessionId)).linked, 0);
});
test('strict quality report and CSV agree, retain valid zero, and report multiple reasons once per row', async () => {
  let response = await exportBatch(request(`batches/${batchId}/export?format=quality`, undefined, 'GET'), ctx());
  assert.equal((await response.json()).data.included, 0);
  await prisma.collectionBatch.update({ where: { batchId }, data: { lockedAt: new Date() } });
  response = await exportBatch(request(`batches/${batchId}/export?format=quality`, undefined, 'GET'), ctx());
  const report = (await response.json()).data;
  assert.equal(report.checked, 5); assert.equal(report.included, 1); assert.equal(report.excluded, 4);
  assert.equal(report.reasons.TIME_NOT_SYNCED, 1); assert.equal(report.reasons.SENSOR_INVALID_MQ136_RAW, 1);
  const csvResponse = await exportBatch(request(`batches/${batchId}/export?format=ml`, undefined, 'GET'), ctx()); assert.equal(csvResponse.status, 200);
  const lines = (await csvResponse.text()).replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length - 1, report.included); assert.equal(lines[0], ML_CSV_HEADERS.join(','));
  const row = lines[1].split(','); assert.equal(row[ML_CSV_HEADERS.indexOf('mq137_raw')], '0'); assert.equal(row[ML_CSV_HEADERS.indexOf('shrimp_weight_g')], '450');
  assert.equal(new Set(lines.slice(1).map((line) => line.split(',')[2])).size, report.included);
  assert.equal((await exportBatch(request(`batches/${batchId}/export?format=ml&isBaseline=true`, undefined, 'GET'), ctx())).status, 422);
});
test('locked batches prevent edits and relinking, while historical type remains nullable', async () => {
  assert.equal((await patchBatch(request(`batches/${batchId}`, { shrimpType: 'windu' }, 'PATCH'), ctx())).status, 409);
  await assert.rejects(() => backfillSessionReadings(sessionId), /terkunci/);
  const original = await prisma.collectionBatch.findUniqueOrThrow({ where: { batchId } });
  const legacy = await prisma.collectionBatch.create({ data: { ...original, id: randomUUID(), batchId: 'BT-20991106-99', shrimpType: null, lockedAt: null } });
  assert.equal(legacy.shrimpType, null);
});
