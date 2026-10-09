import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { buildGroupId } from '../../../../../../shared/dataset.ts';
import {
  serializeGroup,
  parseStorageCondition,
  parseVisualCheck,
  parsePositiveNumber,
  parseBoundedNumber,
  parseIntMinimum,
} from '../../../../../../lib/api/dataset.ts';

const TARGET_TEMP: Record<'ROOM_TEMP' | 'COLD', number> = {
  ROOM_TEMP: 25.0,
  COLD: 4.0,
};

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
      const results = [];
      for (const item of groupsInput) {
        const { api: storageApi, db: storageDb } = parseStorageCondition(item?.storageCondition);
        const labTempC = parseBoundedNumber(item?.labTempC, 'labTempC', -2, 30);
        const visualCheck = parseVisualCheck(item?.visualCheck);
        const labWeightG = parsePositiveNumber(item?.labWeightG, 'labWeightG', 2000);
        const sampleShrimpCount = parseIntMinimum(item?.sampleShrimpCount, 'sampleShrimpCount', 3);
        if (sampleShrimpCount > 5) {
          throw validationError('Field "sampleShrimpCount" harus 3–5 ekor per chamber');
        }
        const sampleWeightG = parsePositiveNumber(item?.sampleWeightG, 'sampleWeightG', 2000);
        const shrimpLengthCm = parseBoundedNumber(item?.shrimpLengthCm, 'shrimpLengthCm', 1, 50);

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
              groupId: buildGroupId(batchId, storageApi),
              batchId,
              storageCondition: storageDb,
              targetTempC: TARGET_TEMP[storageDb],
              labTempC,
              visualCheck,
              labWeightG,
              shrimpLengthCm,
              sampleShrimpCount,
              sampleWeightG,
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
