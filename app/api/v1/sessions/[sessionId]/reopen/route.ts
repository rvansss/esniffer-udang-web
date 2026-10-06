import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound } from '../../../../../../lib/api/errors.ts';
import { serializeSession } from '../../../../../../lib/api/dataset.ts';

/**
 * Membuka kembali sesi INCOMPLETE (selesai tanpa data tertaut) menjadi OPEN
 * agar pengukuran bisa diulang dengan session_id yang sama. Sesi COMPLETE
 * tidak bisa dibuka kembali; sesi OPEN tidak perlu dibuka.
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
    if (session.status !== 'INCOMPLETE') {
      throw conflict(
        `Hanya sesi INCOMPLETE yang bisa dibuka ulang (status saat ini: ${session.status.toLowerCase()})`
      );
    }

    const reopened = await prisma.measurementSession.update({
      where: { sessionId },
      data: { status: 'OPEN', endedAtUtc: null, cleaningDone: false },
    });

    return jsonResponse(serializeSession(reopened));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
