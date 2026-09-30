import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { parseLimit, parseRequiredString } from '../../../../lib/api/validation.ts';
import { conflict, validationError } from '../../../../lib/api/errors.ts';
import { isValidDeviceId } from '../../../../shared/topic.ts';
import { Prisma } from '@prisma/client';

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
    const activeParam = url.searchParams.get('active');
    const chamberId = url.searchParams.get('chamberId');
    const cursor = url.searchParams.get('cursor');

    const where: Prisma.DeviceWhereInput = {};
    if (activeParam === 'true') {
      where.isActive = true;
    } else if (activeParam === 'false') {
      where.isActive = false;
    } else if (activeParam !== null) {
      throw validationError('Query param "active" must be "true" or "false"');
    }

    if (chamberId) {
      where.assignments = {
        some: {
          chamberId,
          activeUntil: null,
        },
      };
    }

    let cursorObj: { createdAt: string; id: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded && typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
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
        { createdAt: { lt: new Date(cursorObj.createdAt) } },
        { createdAt: new Date(cursorObj.createdAt), id: { lt: cursorObj.id } },
      ];
    }

    const devices = await prisma.device.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

    const hasMore = devices.length > limit;
    const items = hasMore ? devices.slice(0, limit) : devices;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
        'utf8'
      ).toString('base64url');
    }

    const data = items.map((d) => {
      const activeAssignment = d.assignments[0] || null;
      return {
        id: d.id,
        mqttDeviceId: d.mqttDeviceId,
        name: d.name,
        isActive: d.isActive,
        connectionState: d.connectionState,
        connectionEvidence: d.connectionEvidence,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        lastStatusProcessedAt: d.lastStatusProcessedAt ? d.lastStatusProcessedAt.toISOString() : null,
        firmwareVersion: d.firmwareVersion,
        activeAssignment: activeAssignment
          ? {
              id: activeAssignment.id,
              activeFrom: activeAssignment.activeFrom.toISOString(),
              chamber: activeAssignment.chamber,
            }
          : null,
        unresolvedCount: d._count.readings,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      };
    });

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
    const mqttDeviceId = parseRequiredString(body?.mqttDeviceId, 'mqttDeviceId', 3, 64);
    const name = parseRequiredString(body?.name, 'name', 2, 100);

    if (!isValidDeviceId(mqttDeviceId)) {
      throw validationError(
        'mqttDeviceId may only contain characters [A-Za-z0-9_-] and must be at most 64 characters long'
      );
    }

    const existing = await prisma.device.findUnique({
      where: { mqttDeviceId },
    });
    if (existing) {
      throw conflict(`Device with mqttDeviceId "${mqttDeviceId}" already exists`);
    }

    const device = await prisma.device.create({
      data: {
        mqttDeviceId,
        name,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : true,
      },
    });

    return jsonResponse(
      {
        id: device.id,
        mqttDeviceId: device.mqttDeviceId,
        name: device.name,
        isActive: device.isActive,
        connectionState: device.connectionState,
        createdAt: device.createdAt.toISOString(),
        updatedAt: device.updatedAt.toISOString(),
      },
      undefined,
      201
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
