import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { serializeDraft } from '../../../../../../lib/dataset/batch-drafts.ts';

/**
 * Menandai draf sudah menjadi batch.
 *
 * Dipisahkan dari DELETE supaya jejak "draf ini menjadi batch X" tetap ada:
 * kalau nanti ada pertanyaan "kenapa angkanya berbeda dari yang saya isi",
 * rantainya bisa ditelusuri. Idempoten — draf yang sudah dikonsumsi cukup
 * dikembalikan apa adanya, jadi retry karena jaringan tidak menimbulkan error.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { user } = await requireAuth(request, ['ADMIN']);
    const { draftId } = await context.params;

    const body = await request.json().catch(() => undefined);
    const batchId = (body as { batchId?: unknown } | undefined)?.batchId;
    if (typeof batchId !== 'string' || batchId.trim() === '') {
      throw validationError('Field "batchId" wajib diisi');
    }

    const draft = await prisma.batchDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.ownerId !== user.id) {
      throw notFound(`Draft "${draftId}" not found`);
    }
    const batch = await prisma.collectionBatch.findUnique({
      where: { batchId },
      select: { batchId: true },
    });
    if (!batch) throw notFound(`Batch "${batchId}" not found`);

    if (draft.status === 'OPEN') {
      const updated = await prisma.batchDraft.update({
        where: { id: draftId },
        data: { status: 'CONSUMED', consumedBatchId: batchId, version: { increment: 1 } },
      });
      return jsonResponse(serializeDraft(updated));
    }

    return jsonResponse(serializeDraft(draft));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
