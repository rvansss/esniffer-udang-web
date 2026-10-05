import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound, payloadTooLarge, validationError } from '../../../../../../lib/api/errors.ts';
import { DATASET_CSV_HEADERS, buildCsvRow } from '../../../../../../lib/api/csv.ts';
import { logger } from '../../../../../../lib/logging/logger.ts';
import { Prisma } from '@prisma/client';

const MAX_EXPORT_ROWS = 50000;
const BATCH_SIZE = 1000;

const DB_TO_SOURCE: Record<string, string> = { MARKET: 'market', FARM: 'farm' };
const DB_TO_STORAGE: Record<string, string> = { ROOM_TEMP: 'room_temp', COLD: 'cold' };

/**
 * Export CSV ML-ready per batch (VIEWER+): join metadata + readings.
 * Header persis contoh PRD; is_baseline 'true'/'false'; null → sel kosong.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { batchId } = await context.params;

    const batch = await prisma.collectionBatch.findUnique({ where: { batchId } });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }

    const url = new URL(request.url);
    const filterSessionId = url.searchParams.get('sessionId');
    const filterTimepoint = url.searchParams.get('timepointCode');
    const filterBaseline = url.searchParams.get('isBaseline');

    const baseWhere: Prisma.SensorReadingWhereInput = {
      batchId,
      measurementTimeQuality: { in: ['SYNCED', 'RECONSTRUCTED'] },
    };
    if (filterSessionId) {
      const session = await prisma.measurementSession.findUnique({
        where: { sessionId: filterSessionId },
      });
      if (!session || session.batchId !== batchId) {
        throw notFound(`Session "${filterSessionId}" not found in batch "${batchId}"`);
      }
      baseWhere.sessionId = session.id;
    }
    if (filterTimepoint) {
      baseWhere.timepointCode = filterTimepoint;
    }
    if (filterBaseline === 'true') {
      baseWhere.isBaseline = true;
    } else if (filterBaseline === 'false') {
      baseWhere.isBaseline = false;
    } else if (filterBaseline !== null) {
      throw validationError('Query param "isBaseline" must be "true" or "false"');
    }

    const totalCount = await prisma.sensorReading.count({ where: baseWhere });
    if (totalCount > MAX_EXPORT_ROWS) {
      throw payloadTooLarge(
        `Requested export contains ${totalCount} rows, which exceeds the maximum limit of ${MAX_EXPORT_ROWS} rows. Filter by session or timepoint.`
      );
    }

    const sourceType = DB_TO_SOURCE[batch.sourceType] ?? batch.sourceType;
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
            controller.enqueue(encoder.encode(buildCsvRow(DATASET_CSV_HEADERS)));
            headerSent = true;
          }

          if (totalCount === 0) {
            done = true;
            controller.close();
            return;
          }

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
            include: {
              device: { select: { mqttDeviceId: true } },
              session: {
                select: {
                  sessionId: true,
                  timepointCode: true,
                  elapsedHours: true,
                  group: { select: { storageCondition: true } },
                },
              },
            },
          });

          if (chunk.length === 0) {
            done = true;
            controller.close();
            return;
          }

          let buffer = '';
          for (const r of chunk) {
            buffer += buildCsvRow([
              r.measuredAt ? r.measuredAt.toISOString() : '',
              r.session?.sessionId ?? '',
              batchId,
              sourceType,
              r.session?.group ? (DB_TO_STORAGE[r.session.group.storageCondition] ?? '') : '',
              r.timepointCode ?? r.session?.timepointCode ?? '',
              r.session?.elapsedHours ?? '',
              r.mq137Raw !== null ? Number(r.mq137Raw) : '',
              r.mq136Raw !== null ? Number(r.mq136Raw) : '',
              r.mq4Raw !== null ? Number(r.mq4Raw) : '',
              r.temperatureC !== null ? Number(r.temperatureC) : '',
              r.humidityPercent !== null ? Number(r.humidityPercent) : '',
              r.isBaseline === null ? '' : String(r.isBaseline),
            ]);
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
              operation: 'dataset_export_stream',
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
            operation: 'dataset_export_stream',
            outcome: 'canceled',
            correlation_id: requestId,
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dataset-${batchId}.csv"`,
        'Cache-Control': 'no-store, private',
        'x-request-id': requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
