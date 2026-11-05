import { lockEditableBatch } from '../../../../../lib/dataset/groups.ts';
import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { conflict, notFound, validationError } from '../../../../../lib/api/errors.ts';
import { serializeSession, parseBoundedNumber, parsePositiveNumber } from '../../../../../lib/api/dataset.ts';

/**
 * Koreksi data observasi satu tahap (ikon pensil di tabel riwayat dinamis
 * halaman detail batch): suhu udang dan berat total udang sesi tersebut.
 * Kirim null untuk mengosongkan. Batch terkunci ditolak 409. Foto tidak
 * lewat sini — route /photos kelola unggah dan hapus foto per sesi.
 */
export async function PATCH(
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
      include: { batch: { select: { lockedAt: true, batchId: true } } },
    });
    if (!session) {
      throw notFound(`Session "${sessionId}" not found`);
    }
    if (session.batch.lockedAt) {
      throw conflict(`Batch "${session.batch.batchId}" sudah terkunci dan tidak bisa diubah`);
    }
    if (session.status === 'LOCKED') {
      throw conflict(`Sesi "${sessionId}" sudah terkunci`);
    }

    const body = await request.json().catch(() => ({}));
    const data: {
      shrimpTempC?: number | null;
      shrimpWeightG?: number | null;
    } = {};

    if (body?.shrimpTempC !== undefined) {
      data.shrimpTempC = body.shrimpTempC === null
        ? null
        : parseBoundedNumber(body.shrimpTempC, 'shrimpTempC', -2, 30);
    }
    if (body?.shrimpWeightG !== undefined) {
      data.shrimpWeightG = body.shrimpWeightG === null
        ? null
        : parsePositiveNumber(body.shrimpWeightG, 'shrimpWeightG', 2000);
    }

    if (Object.keys(data).length === 0) {
      throw validationError('Body harus memuat minimal satu field: shrimpTempC atau shrimpWeightG');
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, session.batchId);
      return tx.measurementSession.update({ where: { sessionId }, data });
    });
    return jsonResponse(serializeSession(updated));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Hapus sesi pengujian / tahap observasi:
 * - Melepas relasi sensor_reading (set sessionId, batchId, timepointCode, isBaseline = null)
 * - Menghapus foto batch khusus sesi ini
 * - Menghapus baris measurementSession
 * Batch terkunci ditolak 409.
 */
export async function DELETE(
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
      include: { batch: { select: { lockedAt: true, batchId: true } } },
    });
    if (!session) {
      throw notFound(`Session "${sessionId}" not found`);
    }
    if (session.batch.lockedAt) {
      throw conflict(`Batch "${session.batch.batchId}" sudah terkunci dan tidak bisa diubah`);
    }
    if (session.status === 'LOCKED') {
      throw conflict(`Sesi "${sessionId}" sudah terkunci`);
    }

    await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, session.batchId);
    // 1. Lepas relasi sensor reading agar tidak tertahan oleh onDelete: Restrict
    await tx.sensorReading.updateMany({
      where: { sessionId: session.id },
      data: {
        sessionId: null,
        batchId: null,
        timepointCode: null,
        isBaseline: null,
      },
    });

    // 2. Hapus foto yang diunggah khusus untuk sesi ini
    await tx.batchPhoto.deleteMany({
      where: { sessionId: session.sessionId },
    });

    // 3. Hapus sesi pengukuran
    await tx.measurementSession.delete({
      where: { sessionId },
    });

    });

    return jsonResponse({
      deleted: true,
      sessionId: session.sessionId,
      timepointCode: session.timepointCode,
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
