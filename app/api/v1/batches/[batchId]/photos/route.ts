import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, payloadTooLarge, validationError } from '../../../../../../lib/api/errors.ts';
import { MAX_BATCH_PHOTOS, MAX_PHOTO_BYTES } from '../../../../../../shared/dataset.ts';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** Nama file aman anti-traversal: <batchId>_<timestamp>_<index>.<ext>. */
function buildFileName(batchId: string, index: number, mimeType: string): string {
  return `${batchId}_${Date.now()}_${index}${ALLOWED_TYPES[mimeType]}`;
}

/**
 * Upload foto dokumentasi batch (ADMIN, multi-file, lokal).
 * Syarat: batch ada + belum terkunci, maks 10 file @5MB jpg/png.
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

    const batch = await prisma.collectionBatch.findUnique({ where: { batchId } });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }
    if (batch.lockedAt) {
      throw conflict(`Batch "${batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw validationError('Body harus multipart/form-data dengan field "photos"');
    }
    const files = form.getAll('photos').filter((v): v is File => v instanceof File);
    if (files.length === 0) {
      throw validationError('Field "photos" wajib berisi minimal 1 file jpg/png');
    }
    if (batch.photoUrls.length + files.length > MAX_BATCH_PHOTOS) {
      throw payloadTooLarge(
        `Maksimal ${MAX_BATCH_PHOTOS} foto per batch (sudah ada ${batch.photoUrls.length})`
      );
    }
    for (const file of files) {
      if (!(file.type in ALLOWED_TYPES)) {
        throw validationError(`File "${file.name}" harus jpg/png`);
      }
      if (file.size > MAX_PHOTO_BYTES) {
        throw payloadTooLarge(`File "${file.name}" melebihi 5MB`);
      }
      if (file.size === 0) {
        throw validationError(`File "${file.name}" kosong`);
      }
    }

    const dir = path.join(process.cwd(), 'public', 'uploads', batchId);
    await mkdir(dir, { recursive: true });

    const saved: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const fileName = buildFileName(batchId, batch.photoUrls.length + i, files[i].type);
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(dir, fileName), buffer);
      saved.push(`uploads/${batchId}/${fileName}`);
    }

    const updated = await prisma.collectionBatch.update({
      where: { batchId },
      data: { photoUrls: { push: saved } },
    });

    return jsonResponse({ batchId, photoUrls: updated.photoUrls }, undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
