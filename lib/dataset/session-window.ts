import type { Prisma } from '@prisma/client';
import { conflict, notFound, validationError } from '../api/errors.ts';

export async function assertSessionWindow(tx: Prisma.TransactionClient, input: {
  chamberId: string; startedAtUtc: Date; endedAtUtc: Date; excludeId?: string;
}) {
  const chambers = await tx.$queryRaw<Array<{ is_active: boolean }>>`
    SELECT is_active FROM chambers WHERE id = ${input.chamberId}::uuid FOR UPDATE`;
  if (!chambers.length) throw notFound('Chamber tidak ditemukan');
  if (!chambers[0].is_active) throw validationError('Chamber harus aktif');
  const overlaps = await tx.$queryRaw<Array<{ session_id: string }>>`
    SELECT session_id FROM measurement_sessions
    WHERE chamber_id = ${input.chamberId}::uuid
      AND (${input.excludeId ?? null}::uuid IS NULL OR id <> ${input.excludeId ?? null}::uuid)
      AND started_at_utc < ${input.endedAtUtc}
      AND COALESCE(ended_at_utc, started_at_utc + COALESCE(duration_seconds, 900) * INTERVAL '1 second') > ${input.startedAtUtc}
    LIMIT 1`;
  if (overlaps.length) throw conflict(`Rentang waktu chamber bertumpang tindih dengan sesi ${overlaps[0].session_id}`);
}
