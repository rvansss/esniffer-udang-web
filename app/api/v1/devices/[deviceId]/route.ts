import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { notFound, validationError } from '../../../../../lib/api/errors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ deviceId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { deviceId } = await context.params;

    const device = await prisma.device.findFirst({
      where: UUID_REGEX.test(deviceId) ? { id: deviceId } : { mqttDeviceId: deviceId },
      include: {
        assignments: {
          where: { activeUntil: null },
          include: {
            chamber: {
              select: { id: true, code: true, name: true },
            },
          },
        },
        _count: {
          select: {
            readings: {
              where: { measurementTimeQuality: 'UNKNOWN' },
            },
          },
        },
      },
    });

    if (!device) {
      throw notFound(`Device "${deviceId}" not found`);
    }

    const activeAssignment = device.assignments[0] || null;

    return jsonResponse({
      id: device.id,
      mqttDeviceId: device.mqttDeviceId,
      name: device.name,
      isActive: device.isActive,
      connectionState: device.connectionState,
      connectionEvidence: device.connectionEvidence,
      currentBootId: device.currentBootId,
      currentSessionId: device.currentSessionId,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      lastStatusProcessedAt: device.lastStatusProcessedAt ? device.lastStatusProcessedAt.toISOString() : null,
      firmwareVersion: device.firmwareVersion,
      activeAssignment: activeAssignment
        ? {
            id: activeAssignment.id,
            activeFrom: activeAssignment.activeFrom.toISOString(),
            chamber: activeAssignment.chamber,
          }
        : null,
      unresolvedCount: device._count.readings,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deviceId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);
    const { deviceId } = await context.params;

    const device = await prisma.device.findFirst({
      where: UUID_REGEX.test(deviceId) ? { id: deviceId } : { mqttDeviceId: deviceId },
    });

    if (!device) {
      throw notFound(`Device "${deviceId}" not found`);
    }

    const body = await request.json();
    const data: { name?: string; isActive?: boolean } = {};

    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw validationError('Device name must be a non-empty string');
      }
      data.name = body.name.trim();
    }

    if (body?.isActive !== undefined) {
      data.isActive = Boolean(body.isActive);
    }

    const updated = await prisma.device.update({
      where: { id: device.id },
      data,
    });

    return jsonResponse({
      id: updated.id,
      mqttDeviceId: updated.mqttDeviceId,
      name: updated.name,
      isActive: updated.isActive,
      connectionState: updated.connectionState,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
