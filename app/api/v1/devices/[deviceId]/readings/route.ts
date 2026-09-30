import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseLimit, parseIsoDate } from '../../../../../../lib/api/validation.ts';
import { notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { Prisma, MeasurementTimeQuality } from '@prisma/client';

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
    });

    if (!device) {
      throw notFound(`Device "${deviceId}" not found`);
    }

    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
    const qualityParam = url.searchParams.get('quality') || url.searchParams.get('measurementTimeQuality');
    const fromReceivedAt = parseIsoDate(url.searchParams.get('fromReceivedAt'), 'fromReceivedAt');
    const toReceivedAt = parseIsoDate(url.searchParams.get('toReceivedAt'), 'toReceivedAt');
    const cursor = url.searchParams.get('cursor');

    const where: Prisma.SensorReadingWhereInput = {
      deviceId: device.id,
    };

    if (qualityParam) {
      const q = qualityParam.toUpperCase();
      if (q in MeasurementTimeQuality) {
        where.measurementTimeQuality = q as MeasurementTimeQuality;
      } else {
        throw validationError(`Invalid quality filter "${qualityParam}". Expected: SYNCED, RECONSTRUCTED, UNKNOWN`);
      }
    }

    if (fromReceivedAt || toReceivedAt) {
      where.receivedAt = {};
      if (fromReceivedAt) where.receivedAt.gte = fromReceivedAt;
      if (toReceivedAt) where.receivedAt.lte = toReceivedAt;
    }

    let cursorObj: { receivedAt: string; id: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (decoded && typeof decoded.receivedAt === 'string' && typeof decoded.id === 'string') {
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
        { receivedAt: { lt: new Date(cursorObj.receivedAt) } },
        { receivedAt: new Date(cursorObj.receivedAt), id: { lt: cursorObj.id } },
      ];
    }

    const readings = await prisma.sensorReading.findMany({
      where,
      take: limit + 1,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    });

    const hasMore = readings.length > limit;
    const items = hasMore ? readings.slice(0, limit) : readings;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ receivedAt: last.receivedAt.toISOString(), id: last.id }),
        'utf8'
      ).toString('base64url');
    }

    const data = items.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      chamberId: r.chamberId,
      messageId: r.messageId,
      payloadSha256: r.payloadSha256,
      bootId: r.bootId,
      sequence: r.sequence.toString(),
      sampleUptimeMs: r.sampleUptimeMs ? r.sampleUptimeMs.toString() : null,
      measuredAt: r.measuredAt ? r.measuredAt.toISOString() : null,
      receivedAt: r.receivedAt.toISOString(),
      measurementTimeQuality: r.measurementTimeQuality,
      historySequence: r.historySequence ? r.historySequence.toString() : null,
      values: {
        temperatureC: {
          value: r.temperatureC !== null ? Number(r.temperatureC) : null,
          quality: r.temperatureQuality,
        },
        humidityPercent: {
          value: r.humidityPercent !== null ? Number(r.humidityPercent) : null,
          quality: r.humidityQuality,
        },
        mq137Raw: {
          value: r.mq137Raw !== null ? Number(r.mq137Raw) : null,
          quality: r.mq137Quality,
        },
        mq136Raw: {
          value: r.mq136Raw !== null ? Number(r.mq136Raw) : null,
          quality: r.mq136Quality,
        },
        mq4Raw: {
          value: r.mq4Raw !== null ? Number(r.mq4Raw) : null,
          quality: r.mq4Quality,
        },
      },
    }));

    return jsonResponse(data, { nextCursor, limit, deviceId: device.mqttDeviceId });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
