import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { parseLimit, parseIsoDate, parseRequiredString, parseOptionalString } from '../../../../lib/api/validation.ts';
import { conflict, validationError } from '../../../../lib/api/errors.ts';
import { buildBatchId, wibDateStamp } from '../../../../shared/dataset.ts';
import {
  serializeBatch,
  parseSourceType,
  parseInitialCondition,
  parsePositiveNumber,
  parseFiniteNumber,
  parseBoundedNumber,
  parseIntMinimum,
  assertTransportGates,
  assertProcurementWindow,
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
    const procuredAtUtc = parseIsoDate(body?.procuredAtUtc, 'procuredAtUtc', true)!;
    const marketSource = parseRequiredString(body?.marketSource, 'marketSource', 1, 100);
    const sourceType = parseSourceType(body?.sourceType);
    const shrimpCount = parseIntMinimum(body?.shrimpCount, 'shrimpCount', 10);
    const sizeGrade = parseIntMinimum(body?.sizeGrade, 'sizeGrade', 1);
    const totalWeightG = parsePositiveNumber(body?.totalWeightG, 'totalWeightG', 2000);
    const initialCondition = parseInitialCondition(body?.initialCondition);
    const initialTempC = parseBoundedNumber(body?.initialTempC, 'initialTempC', -2, 30);
    const departedAtUtc = parseIsoDate(body?.departedAtUtc, 'departedAtUtc', true)!;
    const arrivedAtUtc = parseIsoDate(body?.arrivedAtUtc, 'arrivedAtUtc', true)!;
    const coolerTempMinC = parseBoundedNumber(body?.coolerTempMinC, 'coolerTempMinC', 0, 4);
    const coolerTempMaxC = parseBoundedNumber(body?.coolerTempMaxC, 'coolerTempMaxC', 0, 4);
    const iceToShrimpRatio = body?.iceToShrimpRatio === undefined || body?.iceToShrimpRatio === ''
      ? '2:1'
      : parseRequiredString(body?.iceToShrimpRatio, 'iceToShrimpRatio', 3, 8);
    if (!/^\d+:\d+$/.test(iceToShrimpRatio)) {
      throw validationError('Field "iceToShrimpRatio" harus berpola N:N, contoh 2:1');
    }
    const tempStartC = parseFiniteNumber(body?.tempStartC, 'tempStartC');
    const tempEndC = parseFiniteNumber(body?.tempEndC, 'tempEndC');
    const rejectionNotes = parseOptionalString(body?.rejectionNotes, 'rejectionNotes', 500);
    const photoUrls = body?.photoUrls === undefined
      ? []
      : Array.isArray(body.photoUrls) && body.photoUrls.every((u: unknown) => typeof u === 'string' && u.length > 0 && u.length <= 500)
        ? (body.photoUrls as string[])
        : (() => { throw validationError('Field "photoUrls" harus array string path (diisi via upload Fase 4)'); })();

    assertProcurementWindow(procuredAtUtc);
    assertTransportGates(procuredAtUtc, departedAtUtc, arrivedAtUtc, body?.deviationAcknowledged);

    // Auto batch_id server-side; retry naik bila balapan request bersamaan.
    let batch = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // Prefix harus zona WIB sama seperti buildBatchId; memakai tanggal UTC
      // membuat hitungan sekuens salah pada 00:00–06:59 UTC (= pagi WIB).
      const prefix = `BT-${wibDateStamp(procuredAtUtc)}`;
      const existing = await prisma.collectionBatch.count({
        where: { batchId: { startsWith: prefix } },
      });
      const batchId = buildBatchId(procuredAtUtc, existing + attempt);
      try {
        batch = await prisma.collectionBatch.create({
          data: {
            batchId,
            procuredAtUtc,
            marketSource,
            sourceType,
            shrimpCount,
            sizeGrade,
            totalWeightG,
            initialCondition,
            initialTempC,
            departedAtUtc,
            arrivedAtUtc,
            coolerTempMinC,
            coolerTempMaxC,
            iceToShrimpRatio,
            tempStartC,
            tempEndC,
            rejectionNotes,
            photoUrls,
            operatorId: auth.user.id,
          },
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
