import { randomUUID } from 'node:crypto';
import { lockEditableBatch } from '../../../../../../lib/dataset/groups.ts';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { conflict, notFound, payloadTooLarge, validationError } from '../../../../../../lib/api/errors.ts';
import { parsePhotoCaption } from '../../../../../../lib/api/dataset.ts';
import { logger } from '../../../../../../lib/logging/logger.ts';
import { MAX_PHOTO_BYTES } from '../../../../../../shared/dataset.ts';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** Nama file aman anti-traversal: <batchId>_<timestamp>_<index>.<ext>. */
function buildFileName(batchId: string, index: number, mimeType: string): string {
  return `${batchId}_${randomUUID()}_${index}${ALLOWED_TYPES[mimeType]}`;
}

export interface BatchPhotoItem {
  url: string;
  caption: string;
  groupId: string | null;
  sessionId: string | null;
}

/** Daftar foto batch terurut (sumber tunggal kebenaran pengganti array photo_urls). */
async function listPhotos(batchId: string): Promise<BatchPhotoItem[]> {
  const rows = await prisma.batchPhoto.findMany({
    where: { batchId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { url: true, caption: true, groupId: true, sessionId: true },
  });
  return rows.map((r) => ({ url: r.url, caption: r.caption, groupId: r.groupId, sessionId: r.sessionId }));
}

function assertOwnedUrl(url: unknown, prefix: string, batchId: string): string {
  if (typeof url !== 'string' || !url.startsWith(prefix) || url.includes('..')) {
    throw validationError(`Path foto tidak valid atau bukan milik batch "${batchId}": ${String(url).slice(0, 80)}`);
  }
  return url;
}

/**
 * Upload foto dokumentasi batch (ADMIN, multi-file, lokal).
 * Syarat: batch ada + belum terkunci, tiap file maks 5MB jpg/png,
 * tiap file wajib membawa caption (field "captions": array JSON
 * string sejajar urutan file "photos"). Jumlah foto tidak dibatasi.
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

    // Revisi putaran 2 butir 2: foto boleh dipasangkan ke satu grup tertentu
    // (foto pengelompokan di step wizard) lewat field "groupId" opsional.
    const groupIdRaw = form.get('groupId');
    let groupId: string | null = null;
    if (typeof groupIdRaw === 'string' && groupIdRaw.trim() !== '') {
      const group = await prisma.sampleGroup.findFirst({
        where: { groupId: groupIdRaw.trim(), batchId },
        select: { groupId: true },
      });
      if (!group) {
        throw notFound(`Grup "${groupIdRaw.trim()}" tidak ada di batch "${batchId}"`);
      }
      groupId = group.groupId;
    }

    // Revisi tabel riwayat dinamis: foto per tahap menempel ke satu sesi
    // lewat field "sessionId" opsional. Sesi wajib milik batch ini.
    const sessionIdRaw = form.get('sessionId');
    let sessionId: string | null = null;
    if (typeof sessionIdRaw === 'string' && sessionIdRaw.trim() !== '') {
      const session = await prisma.measurementSession.findFirst({
        where: { sessionId: sessionIdRaw.trim(), batchId },
        select: { sessionId: true },
      });
      if (!session) {
        throw notFound(`Sesi "${sessionIdRaw.trim()}" tidak ada di batch "${batchId}"`);
      }
      sessionId = session.sessionId;
    }

    // Offset penomoran file agar tidak tabrakan dengan foto yang sudah ada.
    const existing = await prisma.batchPhoto.count({ where: { batchId } });
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

    const rows: Array<{ batchId: string; url: string; caption: string; sortOrder: number; groupId: string | null; sessionId: string | null }> = [];
    for (let i = 0; i < files.length; i += 1) {
      const fileName = buildFileName(batchId, existing + i, files[i].type);
      const buffer = Buffer.from(await files[i].arrayBuffer());
      await writeFile(path.join(dir, fileName), buffer);
      rows.push({
        batchId,
        url: `uploads/${batchId}/${fileName}`,
        caption: parsedCaptions[i],
        sortOrder: existing + i,
        groupId,
        sessionId,
      });
    }
    try {
      await prisma.$transaction(async (tx) => {
        await lockEditableBatch(tx, batchId);
        await tx.batchPhoto.createMany({ data: rows });
      });
    } catch (err) {
      await Promise.all(rows.map((row) => rm(path.join(process.cwd(), 'public', row.url), { force: true })));
      throw err;
    }

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

    await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, batchId);
      for (const update of updates) await tx.batchPhoto.update({ where: { batchId_url: { batchId, url: update.url } }, data: { caption: update.caption } });
    });

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

    await prisma.$transaction(async (tx) => {
      await lockEditableBatch(tx, batchId);
      await tx.batchPhoto.deleteMany({ where: { batchId, url: { in: targets } } });
    });
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

    return jsonResponse({ batchId, photos: await listPhotos(batchId) });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
