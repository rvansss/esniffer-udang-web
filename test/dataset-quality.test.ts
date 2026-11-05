import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineStats, readingReasons, type QualityReading, type QualitySession } from '../shared/dataset-quality.ts';

const batch = { batchId: 'BT-20261105-01', shrimpType: 'VANAME', lockedAt: new Date() };
const session: QualitySession = {
  id: 'session-uuid', sessionId: 'SES-20261105-01-H0-SR', batchId: batch.batchId, groupId: `${batch.batchId}-SR`, groupBatchId: batch.batchId,
  storageCondition: 'ROOM_TEMP', chamberId: 'chamber', deviceId: 'device', timepointCode: 'H0', elapsedHours: 0,
  status: 'COMPLETE', startedAtUtc: new Date('2026-11-05T01:00:00Z'), endedAtUtc: new Date('2026-11-05T01:05:00Z'), shrimpTempC: 5, shrimpWeightG: 400,
};
const reading: QualityReading = {
  id: 'reading', batchId: batch.batchId, sessionId: session.id, chamberId: 'chamber', deviceId: 'device', timepointCode: 'H0', isBaseline: false,
  measuredAt: new Date('2026-11-05T01:02:00Z'), measurementTimeQuality: 'SYNCED',
  mq137Raw: 0, mq137Quality: 'OK', mq136Raw: 10, mq136Quality: 'OK', mq4Raw: 20, mq4Quality: 'OK', temperatureC: 25, temperatureQuality: 'OK', humidityPercent: 60, humidityQuality: 'OK',
};
test('ml-v1 retains valid zeroes and accepts the exact sample boundary', () => {
  assert.deepEqual(readingReasons(batch, session, reading, true), []);
});
test('missing, NaN, out-of-range, and error sensors are excluded without replacing values', () => {
  for (const value of [null, NaN, -1, 4096]) assert.ok(readingReasons(batch, session, { ...reading, mq137Raw: value }, true).includes('SENSOR_INVALID_MQ137_RAW'));
  assert.ok(readingReasons(batch, session, { ...reading, mq137Quality: 'SENSOR_ERROR' }, true).includes('SENSOR_INVALID_MQ137_RAW'));
});
test('reconstructed time and the exclusive session endpoint are excluded', () => {
  assert.ok(readingReasons(batch, session, { ...reading, measurementTimeQuality: 'RECONSTRUCTED' }, true).includes('TIME_NOT_SYNCED'));
  assert.ok(readingReasons(batch, session, { ...reading, measuredAt: session.endedAtUtc }, true).includes('OUTSIDE_SESSION_WINDOW'));
});
test('complete sessions still require observations, a baseline, and a locked typed batch', () => {
  const reasons = readingReasons({ ...batch, lockedAt: null, shrimpType: null }, { ...session, shrimpWeightG: null }, reading, false);
  for (const reason of ['BATCH_UNLOCKED', 'SHRIMP_TYPE_MISSING', 'OBSERVATION_INVALID', 'BASELINE_MISSING']) assert.ok(reasons.includes(reason));
});
test('reading context cannot borrow another batch, device, or timepoint', () => {
  assert.ok(readingReasons(batch, session, { ...reading, batchId: 'other', deviceId: 'other', timepointCode: 'H6' }, true).includes('RELATION_MISMATCH'));
  assert.ok(readingReasons(batch, { ...session, elapsedHours: 6 }, reading, true).includes('TIMEPOINT_MISMATCH'));
});
test('baseline averages use valid sensors per channel and return null when none exist', () => {
  const baseline = { ...reading, measuredAt: session.startedAtUtc, isBaseline: true };
  const stats = baselineStats(batch, session, [baseline, { ...baseline, mq137Raw: 4000, mq137Quality: 'OUT_OF_RANGE', mq136Raw: 30 }]);
  assert.deepEqual(stats.means, [0, 20, 20]);
  assert.equal(stats.validRows, 1);
  assert.deepEqual(baselineStats(batch, session, []).means, [null, null, null]);
});
test('baseline rows are retained for audit and never exported as sample observations', () => {
  const reasons = readingReasons(batch, session, { ...reading, measuredAt: session.startedAtUtc, isBaseline: true }, true);
  assert.ok(reasons.includes('BASELINE_READING'));
  assert.ok(!reasons.includes('BASELINE_FLAG_MISMATCH'));
});
