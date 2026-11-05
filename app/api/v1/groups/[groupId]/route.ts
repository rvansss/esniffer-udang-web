import { lockEditableBatch, parseGrouping } from '../../../../../lib/dataset/groups.ts';
import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { conflict, notFound, validationError } from '../../../../../lib/api/errors.ts';
import {
  serializeGroup,
  parseBoundedNumber,
  parsePositiveNumber,
  parseColdStorageMode,
} from '../../../../../lib/api/dataset.ts';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edit parsial satu grup (revisi putaran 2 butir 3): field yang sama dengan
 * step pengelompokan wizard. Batch terkunci ditolak 409. Validasi memakai
 * parser lib yang sama dengan pembuatan grup, bukan salinan aturan.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { groupId } = await context.params;

    const group = await prisma.sampleGroup.findUnique({
      where: { groupId },
      include: { batch: true },
    });
    if (!group) {
      throw notFound(`Group "${groupId}" not found`);
    }
    if (group.batch.lockedAt) {
      throw conflict(`Batch "${group.batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    const body = await request.json().catch(() => ({}));
    // Mode dan chamber_id harus berubah dalam satu UPDATE agar CHECK DB tetap valid.
    const data: Prisma.SampleGroupUncheckedUpdateInput = {};
    if (body?.coldStorageMode !== undefined && body.coldStorageMode !== 'chamber') throw validationError('Pengujian baru wajib menggunakan chamber');
    if (body?.visualCheck !== undefined || body?.sampleShrimpCount !== undefined) Object.assign(data, parseGrouping({ visualCheck: body.visualCheck ?? group.visualCheck.toLowerCase(), sampleShrimpCount: body.sampleShrimpCount ?? group.sampleShrimpCount }));
    const coldStorageMode = body?.coldStorageMode === undefined
      ? group.coldStorageMode
      : parseColdStorageMode(body.coldStorageMode);
    let chamberId = group.chamberId;
    if (body?.chamberId !== undefined) {
      if (body.chamberId !== null && (typeof body.chamberId !== 'string' || !UUID_REGEX.test(body.chamberId))) {
        throw validationError('Field "chamberId" harus UUID valid atau null');
      }
      chamberId = body.chamberId;
      if (chamberId !== null) {
        const chamber = await prisma.chamber.findUnique({ where: { id: chamberId } });
        if (!chamber) throw notFound(`Chamber "${chamberId}" not found`);
        if (!chamber.isActive) throw validationError('Chamber yang dipilih harus aktif');
      }
      data.chamberId = chamberId;
    }

    if (body?.labTempC !== undefined) {
      data.labTempC = parseBoundedNumber(body.labTempC, 'labTempC', -2, 30);
    }
    if (body?.labWeightBeforeG !== undefined) {
      data.labWeightBeforeG = parsePositiveNumber(body.labWeightBeforeG, 'labWeightBeforeG', 2000);
    }
    if (body?.labWeightAfterG !== undefined) {
      data.labWeightAfterG = parsePositiveNumber(body.labWeightAfterG, 'labWeightAfterG', 2000);
    }
    if (body?.coldStorageMode !== undefined) {
      const mode = coldStorageMode;
      if (mode === 'PLAIN_FRIDGE' && group.storageCondition !== 'COLD') {
        throw validationError('Field "coldStorageMode" plain_fridge hanya untuk kondisi cold');
      }
      // Konsistensi mode dengan penugasan chamber; aturan terakhir dijaga
      // juga oleh CHECK DB sample_groups_plain_fridge_no_chamber.
      if (mode === 'PLAIN_FRIDGE' && chamberId !== null) {
        throw validationError(
          'Grup plain_fridge harus tanpa chamber; lepaskan penugasan chamber dulu'
        );
      }
      data.coldStorageMode = mode;
    }

    if (coldStorageMode === 'PLAIN_FRIDGE' && chamberId !== null) {
      throw validationError('Pilih mode chamber untuk menautkan chamber ke grup dingin');
    }

    if (Object.keys(data).length === 0) {
      throw validationError(
        'Body harus memuat minimal satu field: labTempC, labWeightBeforeG, labWeightAfterG, coldStorageMode, atau chamberId'
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, group.batchId);
      return tx.sampleGroup.update({ where: { groupId }, data });
    });
    return jsonResponse(serializeGroup(updated));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
