import { prisma } from '../db/client.ts';
import { baselineCutoffUtc } from '../../shared/dataset.ts';
import { lockEditableBatch } from './groups.ts';

export interface BackfillResult { linked: number; baseline: number; skipped: boolean }

/** Bind readings only to a known device, using the same half-open interval as quality checks. */
export async function backfillSessionReadings(sessionId: string): Promise<BackfillResult> {
  return prisma.$transaction(async (tx) => {
    let session = await tx.measurementSession.findUniqueOrThrow({ where: { id: sessionId } });
    await lockEditableBatch(tx, session.batchId);
    if (!session.chamberId || !session.endedAtUtc) {
      await tx.measurementSession.update({ where: { id: sessionId }, data: { status: 'INCOMPLETE' } });
      return { linked: 0, baseline: 0, skipped: true };
    }
    if (!session.deviceId) {
      const assignment = await tx.deviceAssignment.findFirst({ where: {
        chamberId: session.chamberId, activeFrom: { lte: session.startedAtUtc },
        OR: [{ activeUntil: null }, { activeUntil: { gte: session.endedAtUtc } }],
      }, orderBy: { activeFrom: 'desc' } });
      if (assignment) session = await tx.measurementSession.update({ where: { id: sessionId }, data: { deviceId: assignment.deviceId } });
    }
    if (!session.deviceId) {
      await tx.measurementSession.update({ where: { id: sessionId }, data: { status: 'INCOMPLETE' } });
      return { linked: 0, baseline: 0, skipped: true };
    }
    const cutoff = baselineCutoffUtc(session.startedAtUtc);
    const linked = Number(await tx.$executeRaw`
      UPDATE sensor_readings SET session_id = ${sessionId}::uuid, batch_id = ${session.batchId},
        timepoint_code = ${session.timepointCode}, is_baseline = (measured_at < ${cutoff})
      WHERE chamber_id = ${session.chamberId}::uuid AND device_id = ${session.deviceId}::uuid
        AND measurement_time_quality IN ('SYNCED', 'RECONSTRUCTED')
        AND measured_at >= ${session.startedAtUtc} AND measured_at < ${session.endedAtUtc}
        AND session_id IS NULL`);
    const baselineWhere = { sessionId, isBaseline: true, measuredAt: { gte: session.startedAtUtc, lt: cutoff } };
    const [total, baseline, mq137, mq136, mq4] = await Promise.all([
      tx.sensorReading.count({ where: { sessionId } }),
      tx.sensorReading.count({ where: baselineWhere }),
      tx.sensorReading.aggregate({ where: { ...baselineWhere, mq137Quality: 'OK', mq137Raw: { gte: 0, lte: 4095 } }, _avg: { mq137Raw: true } }),
      tx.sensorReading.aggregate({ where: { ...baselineWhere, mq136Quality: 'OK', mq136Raw: { gte: 0, lte: 4095 } }, _avg: { mq136Raw: true } }),
      tx.sensorReading.aggregate({ where: { ...baselineWhere, mq4Quality: 'OK', mq4Raw: { gte: 0, lte: 4095 } }, _avg: { mq4Raw: true } }),
    ]);
    await tx.measurementSession.update({ where: { id: sessionId }, data: {
      status: total === 0 ? 'INCOMPLETE' : 'COMPLETE',
      baselineMq137: mq137._avg.mq137Raw, baselineMq136: mq136._avg.mq136Raw, baselineMq4: mq4._avg.mq4Raw,
    } });
    return { linked, baseline, skipped: false };
  }, { timeout: 30000 });
}
