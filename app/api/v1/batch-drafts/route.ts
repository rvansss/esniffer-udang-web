import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { resolveAttribution } from '../../../../lib/auth/attribution.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { conflict } from '../../../../lib/api/errors.ts';
import {
  DRAFT_MAX_AGE_MS,
  DRAFT_MAX_OPEN_PER_OWNER,
  isDraftPayloadEmpty,
} from '../../../../shared/batch-draft.ts';
import {
  draftPayloadJson,
  labelForDraft,
  parseDraftPayload,
  parseDraftStep,
  serializeDraft,
} from '../../../../lib/dataset/batch-drafts.ts';

/**
 * Draf wizard batch baru yang tersimpan di server.
 *
 * GET mengembalikan draf terbuka milik akun ini — termasuk yang dibuat
 * operator/perangkat lain — sehingga "isi form di ponsel, lanjutkan di laptop"
 * mungkin. Klien menampilkan pemiliknya supaya operator tahu draf siapa yang
 * akan dilanjutkan.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const { user } = await requireAuth(request, ['VIEWER', 'ADMIN']);
    const rows = await prisma.batchDraft.findMany({
      where: {
        ownerId: user.id,
        status: 'OPEN',
        updatedAt: { gte: new Date(Date.now() - DRAFT_MAX_AGE_MS) },
      },
      orderBy: { updatedAt: 'desc' },
      take: DRAFT_MAX_OPEN_PER_OWNER,
    });
    return jsonResponse(rows.map(serializeDraft), {
      count: rows.length,
      maxAgeDays: Math.round(DRAFT_MAX_AGE_MS / (24 * 60 * 60 * 1000)),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Membuat draf baru. Draf kosong ditolak: draf kosong hanya akan muncul di
 * daftar "lanjutkan" tanpa isi dan membuat operator bingung.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { user } = await requireAuth(request, ['ADMIN']);
    const attribution = resolveAttribution(request);

    const body = await request.json().catch(() => undefined);
    const payload = parseDraftPayload((body as { payload?: unknown } | undefined)?.payload);
    if (isDraftPayloadEmpty(payload)) {
      throw conflict('Draf masih kosong: isi minimal satu field sebelum menyimpan draf.');
    }
    const step = parseDraftStep((body as { step?: unknown } | undefined)?.step ?? 0);

    const open = await prisma.batchDraft.count({ where: { ownerId: user.id, status: 'OPEN' } });
    if (open >= DRAFT_MAX_OPEN_PER_OWNER) {
      throw conflict(
        `Sudah ada ${open} draf terbuka. Selesaikan atau buang salah satu draf sebelum membuat yang baru.`
      );
    }

    const draft = await prisma.batchDraft.create({
      data: {
        ownerId: user.id,
        ownerOperator: attribution.operator,
        ownerDeviceId: attribution.deviceId,
        ownerDeviceLabel: attribution.deviceLabel,
        label: labelForDraft(payload),
        step,
        payload: draftPayloadJson(payload),
      },
    });

    return jsonResponse(serializeDraft(draft), undefined, 201);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
