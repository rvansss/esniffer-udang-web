import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { conflict, notFound } from '../../../../../lib/api/errors.ts';
import { deleteBatch } from '../../../../../lib/dataset/batches.ts';
import {
  serializeBatch,
  serializeGroup,
  serializeSession,
} from '../../../../../lib/api/dataset.ts';

export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { batchId } = await context.params;

    const batch = await prisma.collectionBatch.findUnique({
      where: { batchId },
      include: {
        sampleGroups: {
          orderBy: { storageCondition: 'asc' },
          include: { sessions: { orderBy: { elapsedHours: 'asc' } } },
        },
      },
    });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }

    const photos = await prisma.batchPhoto.findMany({
      where: { batchId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { url: true, caption: true },
    });

    return jsonResponse({
      ...serializeBatch(batch),
      photos: photos.map((p) => ({ url: p.url, caption: p.caption })),
      sampleGroups: batch.sampleGroups.map((g) => ({
        ...serializeGroup(g),
        sessions: g.sessions.map(serializeSession),
      })),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { batchId } = await context.params;
    const force = new URL(request.url).searchParams.get('force') === 'true';

    const result = await deleteBatch(batchId, force);
    if (result.error?.includes('not found')) {
      throw notFound(result.error);
    }
    if (result.error) {
      throw conflict(result.error);
    }
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
