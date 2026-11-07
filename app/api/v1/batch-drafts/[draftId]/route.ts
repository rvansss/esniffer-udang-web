import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { resolveAttribution } from '../../../../../lib/auth/attribution.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { HttpError, conflict, notFound } from '../../../../../lib/api/errors.ts';
import { isDraftPayloadEmpty } from '../../../../../shared/batch-draft.ts';
import {
  draftPayloadJson,
  labelForDraft,
  parseDraftPayload,
  parseDraftStep,
  parseDraftVersion,
  serializeDraft,
} from '../../../../../lib/dataset/batch-drafts.ts';

/** Draf satu akun (semua operator berbagi akun, jadi kepemilikan = akun). */
async function loadOwnDraft(draftId: string, ownerId: string) {
  const draft = await prisma.batchDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.ownerId !== ownerId) throw notFound(`Draft "${draftId}" not found`);
  return draft;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const { user } = await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { draftId } = await context.params;
    return jsonResponse(serializeDraft(await loadOwnDraft(draftId, user.id)));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Menyimpan draf dengan optimistic concurrency.
 *
 * Klien mengirim `version` yang terakhir dibacanya. Bila di perangkat lain draf
 * sudah berubah, versi di DB tidak cocok dan permintaan ditolak 409
 * (`DRAFT_VERSION_CONFLICT`) beserta versi terbaru — draf tidak pernah
 * tertimpa diam-diam, yang justru sering terjadi pada draf localStorage.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ draftId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { user } = await requireAuth(request, ['ADMIN']);
    const { draftId } = await context.params;
    const attribution = resolveAttribution(request);

    const body = await request.json().catch(() => undefined);
    const payload = parseDraftPayload((body as { payload?: unknown } | undefined)?.payload);
    if (isDraftPayloadEmpty(payload)) {
      throw conflict('Draf masih kosong. Buang draf bila memang tidak jadi dipakai.');
    }
    const step = parseDraftStep((body as { step?: unknown } | undefined)?.step);
    const version = parseDraftVersion((body as { version?: unknown } | undefined)?.version);

    const result = await prisma.batchDraft.updateMany({
      where: { id: draftId, ownerId: user.id, status: 'OPEN', version },
      data: {
        payload: draftPayloadJson(payload),
        step,
        label: labelForDraft(payload),
        version: { increment: 1 },
        ownerOperator: attribution.operator,
        ownerDeviceId: attribution.deviceId,
        ownerDeviceLabel: attribution.deviceLabel,
      },
    });

    if (result.count === 0) {
      const current = await loadOwnDraft(draftId, user.id);
      if (current.status !== 'OPEN') {
        throw conflict('Draf ini sudah dipakai atau dibuang, jadi tidak bisa diperbarui lagi.');
      }
      throw new HttpError(
        409,
        'DRAFT_VERSION_CONFLICT',
        'Draf sudah diperbarui di perangkat lain. Muat versi terbaru sebelum menyimpan lagi.',
        [
          {
            version: current.version,
            updatedAt: current.updatedAt.toISOString(),
            ownerOperator: current.ownerOperator,
            ownerDevice: current.ownerDeviceLabel,
          },
        ]
      );
    }

    const fresh = await prisma.batchDraft.findUniqueOrThrow({ where: { id: draftId } });
    return jsonResponse(serializeDraft(fresh));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/** Membuang draf. Status diubah, bukan dihapus, supaya jejaknya tetap ada. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ draftId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { user } = await requireAuth(request, ['ADMIN']);
    const { draftId } = await context.params;

    const draft = await loadOwnDraft(draftId, user.id);
    if (draft.status === 'OPEN') {
      await prisma.batchDraft.update({
        where: { id: draftId },
        data: { status: 'DISCARDED', version: { increment: 1 } },
      });
    }
    return jsonResponse({ discarded: true, draftId });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
