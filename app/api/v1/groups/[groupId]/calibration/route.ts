import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { resolveAttribution } from '../../../../../../lib/auth/attribution.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound, validationError } from '../../../../../../lib/api/errors.ts';
import {
  applyCalibrationAction,
  loadGroupCalibration,
  type CalibrationAction,
} from '../../../../../../lib/dataset/calibration.ts';

const ACTIONS: CalibrationAction[] = ['start', 'advance', 'reset'];

async function assertGroupExists(groupId: string): Promise<void> {
  const group = await prisma.sampleGroup.findUnique({ where: { groupId }, select: { batchId: true } });
  if (!group) throw notFound(`Group "${groupId}" not found`);
}

/**
 * Status kalibrasi dua tahap satu grup.
 *
 * GET boleh dibaca VIEWER karena ini sama dengan isi detail batch; PUT/DELETE
 * hanya ADMIN — mengubah kalibrasi membuka gerbang Start Tahap.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { groupId } = await context.params;
    await assertGroupExists(groupId);
    return jsonResponse(await loadGroupCalibration(groupId));
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/**
 * Menjalankan satu aksi kalibrasi. Waktu mulai selalu diambil dari jam server,
 * jadi klien tidak bisa "mengklaim" chamber sudah ditutup 30 menit.
 *
 * Body: { action: 'start', durations: [30, 5], restart?: boolean }
 *       { action: 'advance', stepIndex: 1, durationMins: 5 }
 *       { action: 'reset' }
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const auth = await requireAuth(request, ['ADMIN']);
    const { groupId } = await context.params;
    const attribution = resolveAttribution(request);

    const body = await request.json().catch(() => undefined);
    const action = (body as { action?: unknown } | undefined)?.action;
    if (typeof action !== 'string' || !ACTIONS.includes(action as CalibrationAction)) {
      throw validationError(
        'Field "action" harus salah satu dari: start, advance, reset'
      );
    }

    const calibration = await applyCalibrationAction({
      groupId,
      action: action as CalibrationAction,
      durations: (body as { durations?: unknown }).durations,
      stepIndex: (body as { stepIndex?: unknown }).stepIndex,
      durationMins: (body as { durationMins?: unknown }).durationMins,
      restart: (body as { restart?: unknown }).restart === true,
      actor: {
        userId: auth.user.id,
        operator: attribution.operator,
        deviceLabel: attribution.deviceLabel,
      },
    });

    return jsonResponse(calibration);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

/** Reset kalibrasi satu grup (bentuk lain dari action: 'reset'). */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const auth = await requireAuth(request, ['ADMIN']);
    const { groupId } = await context.params;
    const attribution = resolveAttribution(request);

    const calibration = await applyCalibrationAction({
      groupId,
      action: 'reset',
      actor: {
        userId: auth.user.id,
        operator: attribution.operator,
        deviceLabel: attribution.deviceLabel,
      },
    });
    return jsonResponse(calibration);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
