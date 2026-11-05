import { groupData, parseGrouping, lockEditableBatch } from '../../../../../../lib/dataset/groups.ts';
import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, validationError } from '../../../../../../lib/api/errors.ts';
import {
  serializeGroup,
  parseStorageCondition,
} from '../../../../../../lib/api/dataset.ts';

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { batchId } = await context.params;

    const batch = await prisma.collectionBatch.findUnique({ where: { batchId } });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }
    if (batch.lockedAt) {
      throw conflict(`Batch "${batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    const body = await request.json();
    const groupsInput = body?.groups;
    if (!Array.isArray(groupsInput) || groupsInput.length < 1 || groupsInput.length > 2) {
      throw validationError('Field "groups" harus array berisi 1–2 grup (SR dan SD)');
    }

    const created = await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, batchId);
      const results = [];
      for (const item of groupsInput) {
        const { api: storageApi, db: storageDb } = parseStorageCondition(item?.storageCondition);
        const fields = parseGrouping(item);
        if (item?.coldStorageMode !== undefined && item.coldStorageMode !== 'chamber') {
          throw validationError('Grup baru wajib menggunakan chamber');
        }
        const existing = await tx.sampleGroup.findUnique({
          where: { batchId_storageCondition: { batchId, storageCondition: storageDb } },
        });
        if (existing) {
          throw conflict(
            `Grup ${storageApi} untuk batch "${batchId}" sudah ada (${existing.groupId})`
          );
        }

        results.push(
          await tx.sampleGroup.create({
            data: {
              ...groupData(batchId, storageApi, fields),
            },
          })
        );
      }
      return results;
    });

    return jsonResponse(created.map(serializeGroup), undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
