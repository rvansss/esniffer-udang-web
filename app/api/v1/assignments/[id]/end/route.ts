import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseIsoDate } from '../../../../../../lib/api/validation.ts';
import { notFound, conflict } from '../../../../../../lib/api/errors.ts';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { id } = await context.params;

    const assignment = await prisma.deviceAssignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      throw notFound(`Assignment "${id}" not found`);
    }

    if (assignment.activeUntil !== null) {
      throw conflict(`Assignment "${id}" is already ended at ${assignment.activeUntil.toISOString()}`);
    }

    let body: { effectiveUntil?: string } | null = null;
    try {
      body = await request.json();
    } catch {}

    const effectiveUntil = parseIsoDate(body?.effectiveUntil ?? null, 'effectiveUntil') || new Date();

    const updated = await prisma.deviceAssignment.update({
      where: { id },
      data: { activeUntil: effectiveUntil },
      include: {
        device: { select: { id: true, mqttDeviceId: true, name: true } },
        chamber: { select: { id: true, code: true, name: true } },
      },
    });

    return jsonResponse({
      id: updated.id,
      deviceId: updated.deviceId,
      chamberId: updated.chamberId,
      activeFrom: updated.activeFrom.toISOString(),
      activeUntil: updated.activeUntil ? updated.activeUntil.toISOString() : null,
      device: updated.device,
      chamber: updated.chamber,
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
