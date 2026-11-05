import { lockEditableBatch, parseGroupingPatch } from '../../../../../lib/dataset/groups.ts';
import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { conflict, notFound } from '../../../../../lib/api/errors.ts';
import { deleteBatch } from '../../../../../lib/dataset/batches.ts';
import {
  serializeBatch,
  serializeGroup,
  serializeSession,
  parseBatchFields,
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
      // Butir 2: groupId + sessionId ikut agar UI bisa menautkan foto ke
      // grupnya dan ke baris tahap di tabel riwayat dinamis.
      select: { url: true, caption: true, groupId: true, sessionId: true },
    });

    return jsonResponse({
      ...serializeBatch(batch),
      photos: photos.map((p) => ({ url: p.url, caption: p.caption, groupId: p.groupId, sessionId: p.sessionId })),
      sampleGroups: batch.sampleGroups.map((g) => ({
        ...serializeGroup(g),
        sessions: g.sessions.map(serializeSession),
      })),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Koreksi data pencatatan (form edit semua bagian di halaman detail):
 * langkah Pengadaan + Kondisi & dokumentasi. Aturan persis seperti POST
 * create (parseBatchFields), dikirim sebagai payload utuh oleh form edit.
 * Batch terkunci ditolak 409. Foto tidak lewat sini (route /photos).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { batchId } = await context.params;

    const existing = await prisma.collectionBatch.findUnique({ where: { batchId } });
    if (!existing) {
      throw notFound(`Batch "${batchId}" not found`);
    }
    if (existing.lockedAt) {
      throw conflict(`Batch "${batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    const incoming = await request.json().catch(() => undefined);
    // Form edit selalu mengirim field lengkap; untuk klien yang mengirim
    // sebagian, nilai lama dipakai sebagai dasar supaya baris yang tidak
    // dikirim tidak berubah tanpa sengaja. Alias lama (coolerTempMinC/MaxC) dinonaktifkan
    // dengan mengosongkan kunci tersebut agar tidak menimpa nilai baru.
    const base = serializeBatch(existing) as Record<string, unknown>;
    delete base.id;
    delete base.sizeGrade;
    delete base.coolerTempMinC;
    delete base.coolerTempMaxC;
    delete base.lockedAt;
    delete base.createdAt;
    const merged = { ...base, ...(incoming as Record<string, unknown> | undefined) };

    const fields = parseBatchFields(merged, existing.shrimpType !== null || incoming?.shrimpType !== undefined);
    const grouping = incoming?.grouping === undefined ? undefined : parseGroupingPatch(incoming.grouping);
    const updated = await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, batchId);
      if (grouping) {
        const count = await tx.sampleGroup.updateMany({ where: { batchId }, data: grouping });
        if (!count.count) throw conflict('Batch belum memiliki grup; buat grup sebelum mengubah pengelompokan');
      }
      return tx.collectionBatch.update({ where: { batchId }, data: fields });
    });
    return jsonResponse(serializeBatch(updated));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {  const requestId = getRequestId(request);

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
