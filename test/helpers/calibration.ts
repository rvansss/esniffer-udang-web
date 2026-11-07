import { prisma } from '../../lib/db/client.ts';

/**
 * Menanam kalibrasi yang sudah selesai untuk satu grup.
 *
 * Sejak gerbangnya pindah ke server, POST /groups/:groupId/sessions menolak
 * sesi live tanpa baris `group_calibrations` yang kedua langkahnya habis.
 * Test yang menguji perilaku lain (timepoint, observasi, ekspor) cukup menanam
 * baris ini alih-alih menunggu 35 menit sungguhan.
 *
 * @param completed `false` menanam kalibrasi yang masih berjalan.
 * @param nowMs     titik "sekarang" untuk menghitung waktu mulai relatif.
 */
export async function seedCalibration(
  batchId: string,
  groupId: string,
  options: { completed?: boolean; nowMs?: number; operator?: string } = {}
): Promise<void> {
  const completed = options.completed ?? true;
  const now = options.nowMs ?? Date.now();
  const minute = 60_000;
  const steps = [
    { key: 'closed', durationMins: 30, startedAtUtc: new Date(now - 40 * minute).toISOString() },
    {
      key: 'measure',
      durationMins: 5,
      // Selesai: langkah 2 mulai 10 menit lalu (5 menit habis).
      // Berjalan: baru mulai 1 menit lalu.
      startedAtUtc: new Date(now - (completed ? 10 : 1) * minute).toISOString(),
    },
  ];

  await prisma.groupCalibration.upsert({
    where: { groupId },
    create: {
      batchId,
      groupId,
      steps,
      completedAtUtc: completed ? new Date(now) : null,
      updatedByOperator: options.operator ?? 'Operator Uji',
      updatedByDevice: 'Test Runner',
    },
    update: {
      batchId,
      steps,
      completedAtUtc: completed ? new Date(now) : null,
      updatedByOperator: options.operator ?? 'Operator Uji',
      updatedByDevice: 'Test Runner',
      version: { increment: 1 },
    },
  });
}
