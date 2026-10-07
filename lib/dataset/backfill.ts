import { prisma } from '../db/client.ts';
import { baselineCutoffUtc } from '../../shared/dataset.ts';

export interface BackfillResult {
  /** Row baru tertaut pada pemanggilan ini (0 bila rerun/idempoten). */
  linked: number;
  /** Total row baseline sesi ini setelah backfill. */
  baseline: number;
  /** True bila sesi tak punya chamber/device sehingga tak ada yang ditautkan. */
  skipped: boolean;
}

/**
 * Menautkan reading live ke sesi yang baru di-complete (Fase 6, PRD §5.1).
 * Worker TIDAK diubah: UPDATE tunggal menautkan row known-time pada
 * chamber+device dalam window [startedAt, endedAt] yang session_id-nya
 * masih NULL. 2 menit pertama (baselineCutoff) ditandai is_baseline=true.
 * Idempoten: rerun hanya menyentuh row NULL sehingga aman diulang.
 * Status akhir: COMPLETE bila ada row tertaut (atau tak ada yang bisa
 * ditautkan), INCOMPLETE bila chamber/device ada tapi window kosong.
 */
export async function backfillSessionReadings(sessionId: string): Promise<BackfillResult> {
  const session = await prisma.measurementSession.findUniqueOrThrow({ where: { id: sessionId } });

  if (!session.chamberId || !session.deviceId || !session.endedAtUtc) {
    await prisma.measurementSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETE' },
    });
    return { linked: 0, baseline: 0, skipped: true };
  }

  const cutoff = baselineCutoffUtc(session.startedAtUtc);
  const linked = Number(
    await prisma.$executeRaw`
      UPDATE sensor_readings
      SET session_id = ${sessionId}::uuid,
          batch_id = ${session.batchId},
          timepoint_code = ${session.timepointCode},
          is_baseline = (measured_at < ${cutoff})
      WHERE chamber_id = ${session.chamberId}::uuid
        AND device_id = ${session.deviceId}::uuid
        AND measurement_time_quality IN ('SYNCED', 'RECONSTRUCTED')
        AND measured_at >= ${session.startedAtUtc}
        AND measured_at <= ${session.endedAtUtc}
        AND session_id IS NULL`
  );

  const grouped = await prisma.sensorReading.groupBy({
    by: ['isBaseline'],
    where: { sessionId },
    _count: { _all: true },
  });
  const baseline = grouped.find((g) => g.isBaseline === true)?._count._all ?? 0;

  // Rata-rata baseline otomatis dari row is_baseline (diabaikan bila tak ada):
  // inilah yang mengisi kolom baseline_mq137/136/4 di export metadata.
  const stats = await prisma.sensorReading.aggregate({
    where: { sessionId, isBaseline: true },
    _avg: { mq137Raw: true, mq136Raw: true, mq4Raw: true },
  });

  await prisma.measurementSession.update({
    where: { id: sessionId },
    data: {
      status: linked === 0 && baseline === 0 ? 'INCOMPLETE' : 'COMPLETE',
      baselineMq137: stats._avg.mq137Raw ?? undefined,
      baselineMq136: stats._avg.mq136Raw ?? undefined,
      baselineMq4: stats._avg.mq4Raw ?? undefined,
    },
  });

  return { linked, baseline, skipped: false };
}
