import { prisma, getCurrentWatermark } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseLimit, parseIsoDate, validateTimeRange } from '../../../../../../lib/api/validation.ts';
import { notFound, validationError } from '../../../../../../lib/api/errors.ts';
import {
  encodeCursor,
  decodeCursor,
  computeFilterHash,
  getCursorSigningSecret,
  type PaginationFilter,
} from '../../../../../../shared/pagination.ts';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ chamberId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { chamberId } = await context.params;

    const chamber = await prisma.chamber.findFirst({
      where: UUID_REGEX.test(chamberId) ? { id: chamberId } : { code: chamberId },
    });

    if (!chamber) {
      throw notFound(`Chamber "${chamberId}" not found`);
    }

    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = parseLimit(url.searchParams.get('limit'), 100, 500);
    const filterDeviceId = url.searchParams.get('deviceId') || undefined;

    let fromDate: Date;
    let toDate: Date;
    let snapshotWatermark: bigint;
    let cursorTuple: { measuredAt: Date; receivedAt: Date; historySequence: bigint } | null = null;
    const cursorSecret = getCursorSigningSecret();

    if (cursor) {
      // Continuation page: validate cursor token
      const rawFrom = url.searchParams.get('from');
      const rawTo = url.searchParams.get('to');
      if (!rawFrom || !rawTo) {
        throw validationError('Parameters "from" and "to" must be identical across paginated cursor requests');
      }
      fromDate = parseIsoDate(rawFrom, 'from', true)!;
      toDate = parseIsoDate(rawTo, 'to', true)!;

      const paginationFilter: PaginationFilter = {
        chamberId: chamber.id,
        deviceId: filterDeviceId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        order: 'DESC',
      };

      try {
        const decoded = decodeCursor(cursor, paginationFilter, cursorSecret);
        snapshotWatermark = BigInt(decoded.wm);
        cursorTuple = {
          measuredAt: new Date(decoded.ma),
          receivedAt: new Date(decoded.ra),
          historySequence: BigInt(decoded.hs),
        };
      } catch (cursorErr) {
        throw validationError(
          cursorErr instanceof Error ? cursorErr.message : 'Invalid or tampered cursor token'
        );
      }
    } else {
      // First page
      const rawFrom = url.searchParams.get('from');
      const rawTo = url.searchParams.get('to');
      if (!rawFrom || !rawTo) {
        throw validationError('Parameters "from" and "to" are required for history queries');
      }
      fromDate = parseIsoDate(rawFrom, 'from', true)!;
      toDate = parseIsoDate(rawTo, 'to', true)!;
      validateTimeRange(fromDate, toDate, 31 * 24 * 60 * 60 * 1000); // Max 31 days

      // Capture snapshot watermark from singleton table — strict, no MAX fallback.
      snapshotWatermark = await getCurrentWatermark();
    }

    // Build Prisma query condition
    const where: Prisma.SensorReadingWhereInput = {
      chamberId: chamber.id,
      measurementTimeQuality: { in: ['SYNCED', 'RECONSTRUCTED'] },
      measuredAt: {
        gte: fromDate,
        lte: toDate,
      },
      historySequence: {
        lte: snapshotWatermark,
      },
    };

    if (filterDeviceId) {
      if (UUID_REGEX.test(filterDeviceId)) {
        where.deviceId = filterDeviceId;
      } else {
        where.device = { mqttDeviceId: filterDeviceId };
      }
    }

    if (cursorTuple) {
      where.OR = [
        { measuredAt: { lt: cursorTuple.measuredAt } },
        {
          measuredAt: cursorTuple.measuredAt,
          receivedAt: { lt: cursorTuple.receivedAt },
        },
        {
          measuredAt: cursorTuple.measuredAt,
          receivedAt: cursorTuple.receivedAt,
          historySequence: { lt: cursorTuple.historySequence },
        },
      ];
    }

    const readings = await prisma.sensorReading.findMany({
      where,
      take: limit + 1,
      orderBy: [
        { measuredAt: 'desc' },
        { receivedAt: 'desc' },
        { historySequence: 'desc' },
      ],
      include: {
        device: { select: { id: true, mqttDeviceId: true, name: true } },
      },
    });

    const hasMore = readings.length > limit;
    const items = hasMore ? readings.slice(0, limit) : readings;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      const filter: PaginationFilter = {
        chamberId: chamber.id,
        deviceId: filterDeviceId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        order: 'DESC',
      };
      nextCursor = encodeCursor(
        {
          v: 1,
          fh: computeFilterHash(filter),
          wm: snapshotWatermark.toString(),
          ma: last.measuredAt!.toISOString(),
          ra: last.receivedAt.toISOString(),
          hs: (last.historySequence || 0n).toString(),
        },
        cursorSecret
      );
    }

    const data = items.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      chamberId: r.chamberId,
      messageId: r.messageId,
      payloadSha256: r.payloadSha256,
      measuredAt: r.measuredAt ? r.measuredAt.toISOString() : null,
      receivedAt: r.receivedAt.toISOString(),
      measurementTimeQuality: r.measurementTimeQuality,
      historySequence: r.historySequence ? r.historySequence.toString() : null,
      device: r.device,
      values: {
        temperatureC: {
          value: r.temperatureC !== null ? Number(r.temperatureC) : null,
          unit: '°C',
          quality: r.temperatureQuality,
        },
        humidityPercent: {
          value: r.humidityPercent !== null ? Number(r.humidityPercent) : null,
          unit: '%RH',
          quality: r.humidityQuality,
        },
        mq137Raw: {
          value: r.mq137Raw !== null ? Number(r.mq137Raw) : null,
          unit: 'raw',
          quality: r.mq137Quality,
        },
        mq136Raw: {
          value: r.mq136Raw !== null ? Number(r.mq136Raw) : null,
          unit: 'raw',
          quality: r.mq136Quality,
        },
        mq4Raw: {
          value: r.mq4Raw !== null ? Number(r.mq4Raw) : null,
          unit: 'raw',
          quality: r.mq4Quality,
        },
      },
    }));

    return jsonResponse(data, {
      nextCursor,
      limit,
      snapshotWatermark: snapshotWatermark.toString(),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
