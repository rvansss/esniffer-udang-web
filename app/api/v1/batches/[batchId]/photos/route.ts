import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, payloadTooLarge, validationError } from '../../../../../../lib/api/errors.ts';
import { parsePhotoCaption } from '../../../../../../lib/api/dataset.ts';
import { logger } from '../../../../../../lib/logging/logger.ts';
import { MAX_BATCH_PHOTOS, MAX_PHOTO_BYTES } from '../../../../../../shared/dataset.ts';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** Nama file aman anti-traversal: <batchId>_<timestamp>_<index>.<ext>. */
function buildFileName(batchId: string, index: number, mimeType: string): string {
  return `${batchId}_${Date.now()}_${index}${ALLOWED_TYPES[mimeType]}`;
}

export interface BatchPhotoItem {
  url: string;
  caption: string;
}

/** Daftar foto batch terurut (sumber tunggal kebenaran pengganti array photo_urls). */
async function listPhotos(batchId: string): Promise<BatchPhotoItem[]> {
  const rows = await prisma.batchPhoto.findMany({
    where: { batchId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { url: true, caption: true },
  });
  return rows.map((r) => ({ url: r.url, caption: r.caption }));
}

function assertOwnedUrl(url: unknown, prefix: string, batchId: string): string {
  if (typeof url !== 'string' || !url.startsWith(prefix) || url.includes('..')) {
    throw validationError(`Path foto tidak valid atau bukan milik batch "${batchId}": ${String(url).slice(0, 80)}`);
  }
  return url;
}

/**
 * Upload foto dokumentasi batch (ADMIN, multi-file, lokal).
 * Syarat: batch ada + belum terkunci, maks 10 file @5MB jpg/png,
 * tiap file wajib membawa caption (field "captions": array JSON
 * string sejajar urutan file "photos").
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
    const captionsRaw = form.get('captions');
    let captions: unknown = [];
    if (typeof captionsRaw === 'string' && captionsRaw !== '') {
      try {
        captions = JSON.parse(captionsRaw);
      } catch {
        throw validationError('Field "captions" harus array JSON string sejajar file "photos"');
      }
    }
    if (!Array.isArray(captions) || captions.length !== files.length) {
      throw validationError('Field "captions" wajib array sejumlah file foto (satu caption per foto)');
    }
    const parsedCaptions = captions.map((c, i) => parsePhotoCaption(c, i));

    const existing = await prisma.batchPhoto.count({ where: { batchId } });
    if (existing + files.length > MAX_BATCH_PHOTOS) {
      throw payloadTooLarge(
        `Maksimal ${MAX_BATCH_PHOTOS} foto per batch (sudah ada ${existing})`
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

    const rows = [];
    for (let i = 0; i < files.length; i += 1) {
      const fileName = buildFileName(batchId, existing + i, files[i].type);
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(dir, fileName), buffer);
      rows.push({
        batchId,
        url: `uploads/${batchId}/${fileName}`,
        caption: parsedCaptions[i],
        sortOrder: existing + i,
      });
    }
    await prisma.batchPhoto.createMany({ data: rows });

    return jsonResponse({ batchId, photos: await listPhotos(batchId) }, undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Ubah caption foto (ADMIN). Body: { photos: [{ url, caption }] }.
 * Dipakai mengisi caption foto lama hasil migrasi maupun mengoreksi
 * caption yang sudah ada. Batch terkunci tidak bisa diubah.
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

    const batch = await prisma.collectionBatch.findUnique({ where: { batchId } });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }
    if (batch.lockedAt) {
      throw conflict(`Batch "${batchId}" sudah terkunci dan tidak bisa diubah`);
    }

    const body = await request.json().catch(() => ({}));
    const items = body?.photos;
    if (!Array.isArray(items) || items.length === 0) {
      throw validationError('Field "photos" harus array berisi minimal 1 { url, caption }');
    }
    const prefix = `uploads/${batchId}/`;
    const owned = await prisma.batchPhoto.findMany({
      where: { batchId },
      select: { url: true },
    });
    const ownedUrls = new Set(owned.map((r) => r.url));
    const updates = items.map((item: unknown, i: number) => {
      const record = (item ?? {}) as { url?: unknown; caption?: unknown };
      const url = assertOwnedUrl(record.url, prefix, batchId);
      if (!ownedUrls.has(url)) {
        throw notFound(`Foto tidak terdaftar di batch "${batchId}": ${url}`);
      }
      return { url, caption: parsePhotoCaption(record.caption, i) };
    });

    await prisma.$transaction(
      updates.map((u) =>
        prisma.batchPhoto.update({
          where: { batchId_url: { batchId, url: u.url } },
          data: { caption: u.caption },
        })
      )
    );

    return jsonResponse({ batchId, photos: await listPhotos(batchId) });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Hapus foto dokumentasi batch (ADMIN). Body: { photoUrls: string[] }.
 * Hanya path milik batch ini (uploads/<batchId>/...) yang diterima.
 */
export async function DELETE(
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

    const body = await request.json().catch(() => ({}));
    const urls = body?.photoUrls;
    if (!Array.isArray(urls) || urls.length === 0) {
      throw validationError('Field "photoUrls" harus array berisi minimal 1 path foto');
    }
    const prefix = `uploads/${batchId}/`;
    const targets = [...new Set(urls.map((u) => assertOwnedUrl(u, prefix, batchId)))];
    const owned = await prisma.batchPhoto.findMany({
      where: { batchId, url: { in: targets } },
      select: { url: true },
    });
    const ownedUrls = new Set(owned.map((r) => r.url));
    const missing = targets.filter((u) => !ownedUrls.has(u));
    if (missing.length > 0) {
      throw notFound(`Foto tidak terdaftar di batch "${batchId}": ${missing[0]}`);
    }

    for (const u of targets) {
      try {
        await rm(path.join(process.cwd(), 'public', u), { force: true });
      } catch (err) {
        logger.warn({
          service: 'web',
          operation: 'batch_photo_delete',
          outcome: 'warning',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await prisma.batchPhoto.deleteMany({ where: { batchId, url: { in: targets } } });

    return jsonResponse({ batchId, photos: await listPhotos(batchId) });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
