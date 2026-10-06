import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { notFound } from '../../../../../lib/api/errors.ts';
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

    return jsonResponse({
      ...serializeBatch(batch),
      sampleGroups: batch.sampleGroups.map((g) => ({
        ...serializeGroup(g),
        sessions: g.sessions.map(serializeSession),
      })),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
