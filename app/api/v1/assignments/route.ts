import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { parseLimit, parseIsoDate, parseRequiredString } from '../../../../lib/api/validation.ts';
import { notFound, conflict, validationError } from '../../../../lib/api/errors.ts';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
    const deviceId = url.searchParams.get('deviceId');
    const chamberId = url.searchParams.get('chamberId');
    const activeParam = url.searchParams.get('active');
    const cursor = url.searchParams.get('cursor');

    const where: Prisma.DeviceAssignmentWhereInput = {};
    if (activeParam === 'true') {
      where.activeUntil = null;
    } else if (activeParam === 'false') {
      where.activeUntil = { not: null };
    }

    if (deviceId) {
      if (UUID_REGEX.test(deviceId)) {
        where.deviceId = deviceId;
      } else {
        where.device = { mqttDeviceId: deviceId };
      }
    }

    if (chamberId) {
      if (UUID_REGEX.test(chamberId)) {
        where.chamberId = chamberId;
      } else {
        where.chamber = { code: chamberId };
      }
    }

    let cursorObj: { activeFrom: string; id: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded && typeof decoded.activeFrom === 'string' && typeof decoded.id === 'string') {
          cursorObj = decoded;
        } else {
          throw new Error('Invalid cursor shape');
        }
      } catch {
        throw validationError('Invalid cursor token');
      }
    }

    if (cursorObj) {
      where.OR = [
        { activeFrom: { lt: new Date(cursorObj.activeFrom) } },
        { activeFrom: new Date(cursorObj.activeFrom), id: { lt: cursorObj.id } },
      ];
    }

    const assignments = await prisma.deviceAssignment.findMany({
      where,
      take: limit + 1,
      orderBy: [{ activeFrom: 'desc' }, { id: 'desc' }],
      include: {
        device: { select: { id: true, mqttDeviceId: true, name: true } },
        chamber: { select: { id: true, code: true, name: true } },
      },
    });

    const hasMore = assignments.length > limit;
    const items = hasMore ? assignments.slice(0, limit) : assignments;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ activeFrom: last.activeFrom.toISOString(), id: last.id }),
        'utf8'
      ).toString('base64url');
    }

    const data = items.map((a) => ({
      id: a.id,
      deviceId: a.deviceId,
      chamberId: a.chamberId,
      activeFrom: a.activeFrom.toISOString(),
      activeUntil: a.activeUntil ? a.activeUntil.toISOString() : null,
      device: a.device,
      chamber: a.chamber,
      createdAt: a.createdAt.toISOString(),
    }));

    return jsonResponse(data, { nextCursor, limit });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);

    const body = await request.json();
    const rawDeviceId = parseRequiredString(body?.deviceId, 'deviceId');
    const rawChamberId = parseRequiredString(body?.chamberId, 'chamberId');
    const effectiveFrom = parseIsoDate(body?.effectiveFrom, 'effectiveFrom') || new Date();

    // Resolve device
    const device = await prisma.device.findFirst({
      where: UUID_REGEX.test(rawDeviceId) ? { id: rawDeviceId } : { mqttDeviceId: rawDeviceId },
    });
    if (!device) {
      throw notFound(`Device "${rawDeviceId}" not found`);
    }

    // Resolve chamber
    const chamber = await prisma.chamber.findFirst({
      where: UUID_REGEX.test(rawChamberId) ? { id: rawChamberId } : { code: rawChamberId },
    });
    if (!chamber) {
      throw notFound(`Chamber "${rawChamberId}" not found`);
    }

    // Transactional reassignment: Close current active assignment and create new one
    try {
      const newAssignment = await prisma.$transaction(async (tx) => {
        // Close active assignment if exists
        await tx.deviceAssignment.updateMany({
          where: { deviceId: device.id, activeUntil: null },
          data: { activeUntil: effectiveFrom },
        });

        // Insert new assignment
        return tx.deviceAssignment.create({
          data: {
            deviceId: device.id,
            chamberId: chamber.id,
            activeFrom: effectiveFrom,
            activeUntil: null,
          },
          include: {
            device: { select: { id: true, mqttDeviceId: true, name: true } },
            chamber: { select: { id: true, code: true, name: true } },
          },
        });
      });

      return jsonResponse(
        {
          id: newAssignment.id,
          deviceId: newAssignment.deviceId,
          chamberId: newAssignment.chamberId,
          activeFrom: newAssignment.activeFrom.toISOString(),
          activeUntil: null,
          device: newAssignment.device,
          chamber: newAssignment.chamber,
          createdAt: newAssignment.createdAt.toISOString(),
        },
        undefined,
        201
      );
    } catch (dbErr: unknown) {
      // Check for PostgreSQL exclusion constraint error (23P01)
      const errObj = dbErr as { code?: string; message?: string };
      if (errObj.code === '23P01' || (errObj.message && errObj.message.includes('conflicting key value violates exclusion constraint'))) {
        throw conflict('Device assignment violates non-overlapping assignment range constraint');
      }
      throw dbErr;
    }
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
