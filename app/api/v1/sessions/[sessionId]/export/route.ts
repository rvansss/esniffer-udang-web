import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound } from '../../../../../../lib/api/errors.ts';
import {
  SESSION_READINGS_CSV_HEADERS,
  CSV_UTF8_BOM,
  buildCsvRow,
  toWibParts,
  toWibIso,
} from '../../../../../../lib/api/csv.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { sessionId } = await context.params;

    const session = await prisma.measurementSession.findFirst({
      where: UUID_REGEX.test(sessionId) ? { id: sessionId } : { sessionId },
      include: {
        batch: true,
        chamber: { select: { id: true, code: true, name: true } },
        device: { select: { id: true, mqttDeviceId: true, name: true } },
      },
    });

    if (!session) {
      throw notFound(`Session "${sessionId}" not found`);
    }

    const readings = await prisma.sensorReading.findMany({
      where: {
        OR: [
          { sessionId: session.id },
          ...(session.endedAtUtc && session.chamberId
            ? [
                {
                  chamberId: session.chamberId,
                  ...(session.deviceId ? { deviceId: session.deviceId } : {}),
                  measuredAt: {
                    gte: session.startedAtUtc,
                    lte: session.endedAtUtc,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [
        { measuredAt: 'asc' },
        { historySequence: 'asc' },
      ],
      select: {
        id: true,
        measuredAt: true,
        receivedAt: true,
        isBaseline: true,
        temperatureC: true,
        humidityPercent: true,
        mq137Raw: true,
        mq136Raw: true,
        mq4Raw: true,
      },
    });

    const startTimeMs = session.startedAtUtc.getTime();
    const rows: unknown[][] = [];

    for (const r of readings) {
      const measuredAt = r.measuredAt ?? r.receivedAt;
      const secondsFromStart = Math.max(0, Math.round((measuredAt.getTime() - startTimeMs) / 1000));
      const wib = toWibParts(measuredAt);
      const wibStr = `${wib.date} ${wib.time}`;

      rows.push([
        secondsFromStart,
        toWibIso(measuredAt),
        wibStr,
        session.sessionId,
        session.batchId,
        session.timepointCode,
        session.elapsedHours,
        r.mq137Raw !== null ? Number(r.mq137Raw) : '',
        r.mq136Raw !== null ? Number(r.mq136Raw) : '',
        r.mq4Raw !== null ? Number(r.mq4Raw) : '',
        r.temperatureC !== null ? Number(r.temperatureC) : '',
        r.humidityPercent !== null ? Number(r.humidityPercent) : '',
        r.isBaseline ? 'true' : 'false',
        session.shrimpTempC !== null ? Number(session.shrimpTempC) : '',
        session.shrimpWeightG !== null ? Number(session.shrimpWeightG) : '',
      ]);
    }

    const csvContent =
      CSV_UTF8_BOM +
      buildCsvRow(SESSION_READINGS_CSV_HEADERS) +
      rows.map((r) => buildCsvRow(r)).join('');

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hasil-${session.sessionId}.csv"`,
        'Cache-Control': 'no-store, private',
        'x-request-id': requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
