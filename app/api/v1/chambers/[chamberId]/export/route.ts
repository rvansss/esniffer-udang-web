import { prisma, getCurrentWatermark } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseIsoDate, validateTimeRange } from '../../../../../../lib/api/validation.ts';
import { notFound, payloadTooLarge, validationError } from '../../../../../../lib/api/errors.ts';
import { READING_CSV_HEADERS, CSV_UTF8_BOM, buildCsvRow, getMaxExportRows, toWibIso, toWibParts } from '../../../../../../lib/api/csv.ts';
import { logger } from '../../../../../../lib/logging/logger.ts';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH_SIZE = 5000;

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
    const rawFrom = url.searchParams.get('from');
    const rawTo = url.searchParams.get('to');
    if (!rawFrom || !rawTo) {
      throw validationError('Parameters "from" and "to" are required for export');
    }

    const fromDate = parseIsoDate(rawFrom, 'from', true)!;
    const toDate = parseIsoDate(rawTo, 'to', true)!;
    validateTimeRange(fromDate, toDate, 31 * 24 * 60 * 60 * 1000);

    const filterDeviceId = url.searchParams.get('deviceId');

    // Freeze snapshot watermark from singleton table.
    // This is the ONLY authoritative source — no MAX(history_sequence) fallback.
    // Late-committed readings that got a sequence above the watermark will be
    // excluded, which is the correct and safe behaviour.
    const snapshotWatermark = await getCurrentWatermark();

    const baseWhere: Prisma.SensorReadingWhereInput = {
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
        baseWhere.deviceId = filterDeviceId;
      } else {
        baseWhere.device = { mqttDeviceId: filterDeviceId };
      }
    }

    // Safeguard: Check total rows before streaming using the frozen snapshot
    const maxExportRows = getMaxExportRows();
    const totalCount = await prisma.sensorReading.count({ where: baseWhere });
    if (totalCount > maxExportRows) {
      throw payloadTooLarge(
        `Rentang waktu ekspor menghasilkan ${totalCount.toLocaleString('id-ID')} baris, melebihi batas maksimum ${maxExportRows.toLocaleString('id-ID')} baris (PAYLOAD_TOO_LARGE). Silakan persempit rentang waktu ekspor.`
      );
    }

    // Pre-cache devices for instant lookup, eliminating secondary DB queries per chunk
    const devices = await prisma.device.findMany({
      select: { id: true, mqttDeviceId: true },
    });
    const deviceMap = new Map<string, string>(devices.map((d) => [d.id, d.mqttDeviceId]));

    // Set up safe streaming with pull-based backpressure and keyset traversal
    const encoder = new TextEncoder();
    const abortSignal = request.signal;

    let lastTuple: { measuredAt: Date; receivedAt: Date; historySequence: bigint } | null = null;
    let exportedCount = 0;
    let headerSent = false;
    let done = false;
    let loggedFailure = false;

    const stream = new ReadableStream({
      async pull(controller) {
        if (done || abortSignal.aborted) {
          try {
            controller.close();
          } catch {}
          return;
        }

        try {
          if (!headerSent) {
            controller.enqueue(encoder.encode(CSV_UTF8_BOM + buildCsvRow(READING_CSV_HEADERS)));
            headerSent = true;
          }

          if (totalCount === 0) {
            done = true;
            controller.close();
            return;
          }

          // Build keyset query condition: (measuredAt ASC, receivedAt ASC, historySequence ASC)
          const queryWhere: Prisma.SensorReadingWhereInput = { ...baseWhere };
          if (lastTuple) {
            queryWhere.AND = [
              {
                OR: [
                  { measuredAt: { gt: lastTuple.measuredAt } },
                  {
                    measuredAt: lastTuple.measuredAt,
                    receivedAt: { gt: lastTuple.receivedAt },
                  },
                  {
                    measuredAt: lastTuple.measuredAt,
                    receivedAt: lastTuple.receivedAt,
                    historySequence: { gt: lastTuple.historySequence },
                  },
                ],
              },
            ];
          }

          const chunk = await prisma.sensorReading.findMany({
            where: queryWhere,
            take: BATCH_SIZE,
            orderBy: [
              { measuredAt: 'asc' },
              { receivedAt: 'asc' },
              { historySequence: 'asc' },
            ],
            select: {
              deviceId: true,
              messageId: true,
              measuredAt: true,
              receivedAt: true,
              measurementTimeQuality: true,
              temperatureC: true,
              temperatureQuality: true,
              humidityPercent: true,
              humidityQuality: true,
              mq137Raw: true,
              mq137Quality: true,
              mq136Raw: true,
              mq136Quality: true,
              mq4Raw: true,
              mq4Quality: true,
              ingestionSource: true,
              historySequence: true,
            },
          });

          if (chunk.length === 0) {
            done = true;
            controller.close();
            return;
          }

          let buffer = '';
          for (const r of chunk) {
            const row = [
              chamber.code,
              deviceMap.get(r.deviceId) || '',
              r.messageId,
              r.measuredAt ? r.measuredAt.toISOString() : '',
              r.receivedAt.toISOString(),
              r.measurementTimeQuality,
              r.temperatureC !== null ? Number(r.temperatureC) : '',
              '°C',
              r.temperatureQuality,
              r.humidityPercent !== null ? Number(r.humidityPercent) : '',
              '%RH',
              r.humidityQuality,
              r.mq137Raw !== null ? Number(r.mq137Raw) : '',
              'raw',
              r.mq137Quality,
              r.mq136Raw !== null ? Number(r.mq136Raw) : '',
              'raw',
              r.mq136Quality,
              r.mq4Raw !== null ? Number(r.mq4Raw) : '',
              'raw',
              r.mq4Quality,
              r.ingestionSource,
              r.measuredAt ? toWibIso(r.measuredAt) : '',
              toWibIso(r.receivedAt),
            ];
            buffer += buildCsvRow(row);
          }

          const last = chunk[chunk.length - 1];
          lastTuple = {
            measuredAt: last.measuredAt!,
            receivedAt: last.receivedAt,
            historySequence: last.historySequence ?? 0n,
          };

          exportedCount += chunk.length;
          controller.enqueue(encoder.encode(buffer));

          if (chunk.length < BATCH_SIZE || exportedCount >= totalCount) {
            done = true;
            controller.close();
          }
        } catch (streamErr) {
          done = true;
          if (!loggedFailure) {
            loggedFailure = true;
            logger.error({
              service: 'web',
              operation: 'csv_export_stream',
              outcome: 'error',
              correlation_id: requestId,
              message: streamErr instanceof Error ? streamErr.message : String(streamErr),
            });
          }
          controller.error(streamErr);
        }
      },

      cancel(reason) {
        done = true;
        if (!loggedFailure) {
          loggedFailure = true;
          logger.warn({
            service: 'web',
            operation: 'csv_export_stream',
            outcome: 'canceled',
            correlation_id: requestId,
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
      },
    });

    const safeFilename = `chamber-${chamber.code}-${toWibParts(fromDate).date}-${toWibParts(toDate).date}.csv`;

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Cache-Control': 'no-store, private',
        'x-request-id': requestId,
        'x-total-count': totalCount.toString(),
      },
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
