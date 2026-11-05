import { prisma } from '../db/client.ts';
import { notFound, payloadTooLarge, validationError } from '../api/errors.ts';
import { ML_RULE_VERSION, ML_SCHEMA_VERSION, baselineStats, readingReasons, type QualityReading, type QualitySession } from '../../shared/dataset-quality.ts';
import { getMaxExportRows, CSV_UTF8_BOM, buildCsvRow, toWibIso } from '../api/csv.ts';

export const ML_CSV_HEADERS = [
  'schema_version', 'rule_version', 'reading_id', 'batch_id', 'group_id', 'session_id', 'chamber_id', 'device_id',
  'shrimp_type', 'market_source', 'source_type', 'storage_condition', 'timepoint_code', 'elapsed_hours',
  'measured_at_utc', 'timestamp_wib', 'measurement_time_quality',
  'mq137_raw', 'mq137_quality', 'mq136_raw', 'mq136_quality', 'mq4_raw', 'mq4_quality',
  'temp_chamber_c', 'temperature_quality', 'rh_chamber_pct', 'humidity_quality',
  'baseline_mq137', 'baseline_mq136', 'baseline_mq4', 'shrimp_temp_c', 'shrimp_weight_g',
] as const;

export async function loadQualityDataset(batchId: string, params: URLSearchParams) {
  const isBaseline = params.get('isBaseline');
  if (isBaseline !== null && isBaseline !== 'false') throw validationError('Ekspor kualitas ML hanya menerima isBaseline=false');
  const sessionId = params.get('sessionId');
  const timepointCode = params.get('timepointCode');
  const snapshot = await prisma.$transaction(async (tx) => {
    const batch = await tx.collectionBatch.findUnique({ where: { batchId }, include: { sampleGroups: { include: { sessions: true } } } });
    if (!batch) throw notFound(`Batch "${batchId}" not found`);
    const sessions = batch.sampleGroups.flatMap((g) => g.sessions);
    if (sessionId && !sessions.some((s) => s.sessionId === sessionId)) throw notFound(`Session "${sessionId}" not found in batch "${batchId}"`);
    const where = {
      OR: [{ batchId }, { session: { batchId } }],
      ...(sessionId || timepointCode ? { session: { ...(sessionId ? { sessionId } : {}), ...(timepointCode ? { timepointCode } : {}) } } : {}),
    };
    if (await tx.sensorReading.count({ where }) > getMaxExportRows()) throw payloadTooLarge('Terlalu banyak reading; filter berdasarkan sesi atau timepoint');
    const readings = await tx.sensorReading.findMany({ where, orderBy: [{ measuredAt: 'asc' }, { id: 'asc' }] });
    return { batch, readings };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });

  const { batch } = snapshot;
  const sessions = new Map<string, QualitySession>();
  for (const group of batch.sampleGroups) for (const session of group.sessions) sessions.set(session.id, {
    ...session, groupBatchId: group.batchId, storageCondition: group.storageCondition,
    shrimpTempC: session.shrimpTempC?.toNumber() ?? null, shrimpWeightG: session.shrimpWeightG?.toNumber() ?? null,
  });
  const readings: QualityReading[] = snapshot.readings.map((r) => ({ ...r,
    mq137Raw: r.mq137Raw?.toNumber() ?? null, mq136Raw: r.mq136Raw?.toNumber() ?? null, mq4Raw: r.mq4Raw?.toNumber() ?? null,
    temperatureC: r.temperatureC?.toNumber() ?? null, humidityPercent: r.humidityPercent?.toNumber() ?? null,
  }));
  const bySession = new Map<string, QualityReading[]>();
  for (const reading of readings) if (reading.sessionId) {
    const rows = bySession.get(reading.sessionId) ?? [];
    rows.push(reading); bySession.set(reading.sessionId, rows);
  }
  const baselines = new Map([...sessions].map(([id, session]) => [id, baselineStats(batch, session, bySession.get(id) ?? [])]));
  const reasons: Record<string, number> = {};
  const included: QualityReading[] = [];
  for (const reading of readings) {
    const session = sessions.get(reading.sessionId ?? '');
    const failures = readingReasons(batch, session, reading, (baselines.get(reading.sessionId ?? '')?.validRows ?? 0) > 0);
    failures.forEach((reason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; });
    if (!failures.length) included.push(reading);
  }
  const report = {
    schemaVersion: ML_SCHEMA_VERSION, ruleVersion: ML_RULE_VERSION, batchId,
    filters: { sessionId, timepointCode, isBaseline: false },
    batchIssues: [...(!batch.lockedAt ? ['BATCH_UNLOCKED'] : []), ...(!batch.shrimpType ? ['SHRIMP_TYPE_MISSING'] : [])],
    sessions: [...sessions.values()].filter((s) => (!sessionId || s.sessionId === sessionId) && (!timepointCode || s.timepointCode === timepointCode)).map((s) => {
      const baselineValidRows = baselines.get(s.id)?.validRows ?? 0;
      const samplesIncluded = included.filter((r) => r.sessionId === s.id).length;
      return { sessionId: s.sessionId, baselineValidRows, samplesIncluded, issues: [...(!baselineValidRows ? ['BASELINE_MISSING'] : []), ...(!samplesIncluded ? ['SAMPLE_MISSING'] : [])] };
    }),
    checked: readings.length, included: included.length, excluded: readings.length - included.length, reasons,
  };
  const csv = () => CSV_UTF8_BOM + buildCsvRow([...ML_CSV_HEADERS]) + included.map((r) => {
    const session = sessions.get(r.sessionId!)!;
    return buildCsvRow([
      ML_SCHEMA_VERSION, ML_RULE_VERSION, r.id, batchId, session.groupId, session.sessionId, session.chamberId, session.deviceId,
      batch.shrimpType!.toLowerCase(), batch.marketSource, batch.sourceType.toLowerCase(), session.storageCondition.toLowerCase(), session.timepointCode, session.elapsedHours,
      r.measuredAt!.toISOString(), toWibIso(r.measuredAt!), r.measurementTimeQuality.toLowerCase(),
      r.mq137Raw, r.mq137Quality.toLowerCase(), r.mq136Raw, r.mq136Quality.toLowerCase(), r.mq4Raw, r.mq4Quality.toLowerCase(),
      r.temperatureC, r.temperatureQuality.toLowerCase(), r.humidityPercent, r.humidityQuality.toLowerCase(),
      ...baselines.get(session.id)!.means, session.shrimpTempC, session.shrimpWeightG,
    ]);
  }).join('');
  return { report, csv };
}
