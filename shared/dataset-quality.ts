import { BASELINE_SECONDS, timepointToElapsedHours } from './dataset.ts';
import { isSensorValueInRange } from './units.ts';

export const ML_RULE_VERSION = 'ml-v1';
export const ML_SCHEMA_VERSION = 1;
export const QUALITY_SENSORS = [
  ['mq137_raw', 'mq137Raw', 'mq137Quality'],
  ['mq136_raw', 'mq136Raw', 'mq136Quality'],
  ['mq4_raw', 'mq4Raw', 'mq4Quality'],
  ['temperature_c', 'temperatureC', 'temperatureQuality'],
  ['humidity_percent', 'humidityPercent', 'humidityQuality'],
] as const;

export interface QualitySession {
  id: string; sessionId: string; batchId: string; groupId: string;
  groupBatchId: string; storageCondition: string;
  chamberId: string | null; deviceId: string | null;
  timepointCode: string; elapsedHours: number; status: string;
  startedAtUtc: Date; endedAtUtc: Date | null;
  shrimpTempC: number | null; shrimpWeightG: number | null;
}
export interface QualityReading {
  id: string; batchId: string | null; sessionId: string | null;
  chamberId: string | null; deviceId: string;
  timepointCode: string | null; isBaseline: boolean | null;
  measuredAt: Date | null; measurementTimeQuality: string;
  mq137Raw: number | null; mq137Quality: string;
  mq136Raw: number | null; mq136Quality: string;
  mq4Raw: number | null; mq4Quality: string;
  temperatureC: number | null; temperatureQuality: string;
  humidityPercent: number | null; humidityQuality: string;
}
export interface QualityBatch { batchId: string; lockedAt: Date | null; shrimpType: string | null }

export function sensorValid(reading: QualityReading, index: number): boolean {
  const [key, valueKey, qualityKey] = QUALITY_SENSORS[index];
  const value = reading[valueKey];
  return reading[qualityKey] === 'OK' && value !== null && isSensorValueInRange(key, value);
}

export function contextReasons(batch: QualityBatch, session: QualitySession | undefined, reading: QualityReading): string[] {
  if (!session) return ['SESSION_MISSING'];
  const reasons: string[] = [];
  if (reading.batchId !== batch.batchId || session.batchId !== batch.batchId || session.groupBatchId !== batch.batchId || reading.sessionId !== session.id || reading.chamberId !== session.chamberId || reading.deviceId !== session.deviceId) reasons.push('RELATION_MISMATCH');
  try {
    if (reading.timepointCode !== session.timepointCode || timepointToElapsedHours(session.timepointCode) !== session.elapsedHours) reasons.push('TIMEPOINT_MISMATCH');
  } catch { reasons.push('TIMEPOINT_MISMATCH'); }
  if (reading.measurementTimeQuality !== 'SYNCED') reasons.push('TIME_NOT_SYNCED');
  const time = reading.measuredAt?.getTime();
  if (time === undefined || !Number.isFinite(time) || !session.endedAtUtc || time < session.startedAtUtc.getTime() || time >= session.endedAtUtc.getTime()) reasons.push('OUTSIDE_SESSION_WINDOW');
  return reasons;
}

/** Baseline statistics never mix rows from other sessions or invalid sensors. */
export function baselineStats(batch: QualityBatch, session: QualitySession, readings: readonly QualityReading[]) {
  const totals = [0, 0, 0];
  const counts = [0, 0, 0];
  let validRows = 0;
  for (const reading of readings) {
    if (contextReasons(batch, session, reading).length || reading.isBaseline !== true || !reading.measuredAt || reading.measuredAt.getTime() >= session.startedAtUtc.getTime() + BASELINE_SECONDS * 1000) continue;
    if ([0, 1, 2].every((i) => sensorValid(reading, i))) validRows++;
    for (let i = 0; i < 3; i++) if (sensorValid(reading, i)) {
      totals[i] += reading[QUALITY_SENSORS[i][1]]!;
      counts[i]++;
    }
  }
  return { validRows, means: totals.map((sum, i) => counts[i] ? sum / counts[i] : null) };
}

export function readingReasons(batch: QualityBatch, session: QualitySession | undefined, reading: QualityReading, hasBaseline: boolean): string[] {
  const reasons = contextReasons(batch, session, reading);
  if (!batch.lockedAt) reasons.push('BATCH_UNLOCKED');
  if (!['VANAME', 'WINDU'].includes(batch.shrimpType ?? '')) reasons.push('SHRIMP_TYPE_MISSING');
  if (session) {
    if (!['COMPLETE', 'LOCKED'].includes(session.status)) reasons.push('SESSION_NOT_COMPLETE');
    if (!session.chamberId || !session.deviceId) reasons.push('SESSION_DEVICE_MISSING');
    if (session.shrimpTempC === null || !Number.isFinite(session.shrimpTempC) || session.shrimpTempC < -2 || session.shrimpTempC > 30 || session.shrimpWeightG === null || !Number.isFinite(session.shrimpWeightG) || session.shrimpWeightG <= 0 || session.shrimpWeightG > 2000) reasons.push('OBSERVATION_INVALID');
    if (!hasBaseline) reasons.push('BASELINE_MISSING');
    const expectedBaseline = reading.measuredAt ? reading.measuredAt.getTime() < session.startedAtUtc.getTime() + BASELINE_SECONDS * 1000 : null;
    if (reading.isBaseline !== expectedBaseline) reasons.push('BASELINE_FLAG_MISMATCH');
    if (expectedBaseline === true) reasons.push('BASELINE_READING');
  }
  QUALITY_SENSORS.forEach(([key], i) => { if (!sensorValid(reading, i)) reasons.push(`SENSOR_INVALID_${key.toUpperCase()}`); });
  return [...new Set(reasons)];
}
