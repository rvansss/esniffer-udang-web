import { prisma } from '../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../lib/api/response.ts';
import { parseLimit, parseRequiredString, parseOptionalString } from '../../../../lib/api/validation.ts';
import { conflict, validationError } from '../../../../lib/api/errors.ts';
import { Prisma } from '@prisma/client';

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
    const activeParam = url.searchParams.get('active');
    const cursor = url.searchParams.get('cursor');

    const where: Prisma.ChamberWhereInput = {};
    if (activeParam === 'true') {
      where.isActive = true;
    } else if (activeParam === 'false') {
      where.isActive = false;
    } else if (activeParam !== null) {
      throw validationError('Query param "active" must be "true" or "false"');
    }

    let cursorObj: { code: string; id: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded && typeof decoded.code === 'string' && typeof decoded.id === 'string') {
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
        { code: { gt: cursorObj.code } },
        { code: cursorObj.code, id: { gt: cursorObj.id } },
      ];
    }

    const chambers = await prisma.chamber.findMany({
      where,
      take: limit + 1,
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      include: {
        _count: {
          select: {
            assignments: {
              where: { activeUntil: null },
            },
          },
        },
      },
    });

    const hasMore = chambers.length > limit;
    const items = hasMore ? chambers.slice(0, limit) : chambers;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ code: last.code, id: last.id }), 'utf8').toString('base64url');
    }

    const data = items.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      isActive: c.isActive,
      activeDeviceCount: c._count.assignments,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
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
    const code = parseRequiredString(body?.code, 'code', 2, 32);
    const name = parseRequiredString(body?.name, 'name', 2, 100);
    const description = parseOptionalString(body?.description, 'description', 500);

    // Code format check
    if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      throw validationError('Chamber code may only contain alphanumeric characters, dashes, and underscores');
    }

    const existing = await prisma.chamber.findUnique({
      where: { code },
    });
    if (existing) {
      throw conflict(`Chamber with code "${code}" already exists`);
    }

    const chamber = await prisma.chamber.create({
      data: {
        code,
        name,
        description,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : true,
      },
    });

    return jsonResponse(
      {
        id: chamber.id,
        code: chamber.code,
        name: chamber.name,
        description: chamber.description,
        isActive: chamber.isActive,
        createdAt: chamber.createdAt.toISOString(),
        updatedAt: chamber.updatedAt.toISOString(),
      },
      undefined,
      201
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
