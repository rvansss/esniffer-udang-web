import { createBatchGroups, parseBatchGrouping } from '../../../../lib/dataset/groups.ts';
import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { parseLimit } from '../../../../lib/api/validation.ts';
import { buildBatchId, wibDateStamp } from '../../../../shared/dataset.ts';
import { conflict, validationError } from '../../../../lib/api/errors.ts';
import {
  serializeBatch,
  parseBatchFields,
} from '../../../../lib/api/dataset.ts';

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
    const lockedParam = url.searchParams.get('locked');

    let where: { lockedAt?: { not: null } | null } = {};
    if (lockedParam === 'true') {
      where = { lockedAt: { not: null } };
    } else if (lockedParam === 'false') {
      where = { lockedAt: null };
    } else if (lockedParam !== null) {
      throw validationError('Query param "locked" must be "true" or "false"');
    }

    const batches = await prisma.collectionBatch.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return jsonResponse(batches.map(serializeBatch), { count: batches.length, limit });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const auth = await requireAuth(request, ['ADMIN']);

    const body = await request.json();
    // Satu sumber kebenaran parsing/gerbang: dipakai juga oleh PATCH
    // /api/v1/batches/[batchId] (form edit semua bagian di halaman detail).
    const fields = parseBatchFields(body);
    const grouping = body?.grouping === undefined ? undefined : parseBatchGrouping(body.grouping);
    // Foto selalu mulai kosong dan diisi lewat upload (tabel batch_photos).

    // Auto batch_id server-side; retry naik bila balapan request bersamaan.
    let batch = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // Prefix harus zona WIB sama seperti buildBatchId; memakai tanggal UTC
      // membuat hitungan sekuens salah pada 00:00–06:59 UTC (= pagi WIB).
      const prefix = `BT-${wibDateStamp(fields.procuredAtUtc)}`;
      const existing = await prisma.collectionBatch.count({
        where: { batchId: { startsWith: prefix } },
      });
      const batchId = buildBatchId(fields.procuredAtUtc, existing + attempt);
      try {
        batch = await prisma.$transaction(async (tx) => {
          const created = await tx.collectionBatch.create({ data: { batchId, ...fields, operatorId: auth.user.id } });
          if (grouping) await createBatchGroups(tx, batchId, grouping);
          return created;
        });
        lastError = null;
        break;
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    if (!batch) {
      throw conflict(`Gagal membuat batch_id unik setelah 5 percobaan: ${String(lastError)}`);
    }

    return jsonResponse(serializeBatch(batch), undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
