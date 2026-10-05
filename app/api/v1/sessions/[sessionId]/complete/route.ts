import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseIsoDate } from '../../../../../../lib/api/validation.ts';
import { conflict, notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { serializeSession, parseFiniteNumber } from '../../../../../../lib/api/dataset.ts';

/**
 * Menyelesaikan sesi: validasi gerbang ringan (cleaning + urutan waktu).
 * Validasi level row (jumlah row, gap, range sensor — GATE D penuh)
 * ditegakkan Fase 6 saat backfill agar worker tidak diubah.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { sessionId } = await context.params;

    const session = await prisma.measurementSession.findUnique({
      where: { sessionId },
      include: { batch: true },
    });
    if (!session) {
      throw notFound(`Session "${sessionId}" not found`);
    }
    if (session.batch.lockedAt) {
      throw conflict(`Batch "${session.batchId}" sudah terkunci dan tidak bisa diubah`);
    }
    if (session.status !== 'OPEN') {
      throw conflict(`Session "${sessionId}" sudah ${session.status.toLowerCase()} dan tidak bisa diubah`);
    }

    const body = await request.json();
    if (body?.cleaningDone !== true) {
      throw validationError('Bersihkan chamber alkohol 70% dulu (cleaningDone harus true)');
    }
    const endedAtUtc = body?.endedAtUtc === undefined
      ? new Date()
      : parseIsoDate(body.endedAtUtc, 'endedAtUtc', true)!;
    if (endedAtUtc.getTime() <= session.startedAtUtc.getTime()) {
      throw validationError('Waktu selesai harus setelah waktu mulai sesi');
    }

    const baselines: Record<string, number | undefined> = {};
    for (const [field, key] of [['baselineMq137', 'baselineMq137'], ['baselineMq136', 'baselineMq136'], ['baselineMq4', 'baselineMq4']] as const) {
      if (body?.[key] !== undefined && body?.[key] !== null) {
        baselines[field] = parseFiniteNumber(body[key], key);
      }
    }

    const updated = await prisma.measurementSession.update({
      where: { sessionId },
      data: {
        endedAtUtc,
        cleaningDone: true,
        status: 'COMPLETE',
        ...baselines,
      },
    });

    return jsonResponse(serializeSession(updated));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
