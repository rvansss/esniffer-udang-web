import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { serializeBatch } from '../../../../../../lib/api/dataset.ts';

/**
 * Mengunci batch: immutable permanen + audit locked_at.
 * Syarat: minimal 1 sesi dan tidak ada sesi OPEN/INCOMPLETE.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { batchId } = await context.params;

    const batch = await prisma.collectionBatch.findUnique({
      where: { batchId },
      include: { sessions: { select: { status: true } } },
    });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }
    if (batch.lockedAt) {
      throw conflict(`Batch "${batchId}" sudah terkunci`);
    }
    if (batch.sessions.length === 0) {
      throw validationError(`Batch "${batchId}" belum memiliki sesi dan tidak bisa dikunci`);
    }
    if (batch.photoUrls.length === 0) {
      throw validationError(`Batch "${batchId}" belum memiliki foto; upload minimal 1 foto dulu`);
    }
    const openCount = batch.sessions.filter((s) => s.status === 'OPEN' || s.status === 'INCOMPLETE').length;
    if (openCount > 0) {
      throw validationError(
        `Batch "${batchId}" masih memiliki ${openCount} sesi belum selesai; complete semua sesi dulu`
      );
    }

    const locked = await prisma.collectionBatch.update({
      where: { batchId },
      data: { lockedAt: new Date() },
    });

    return jsonResponse(serializeBatch(locked));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
