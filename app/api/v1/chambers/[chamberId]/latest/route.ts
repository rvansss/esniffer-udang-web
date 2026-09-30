import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound } from '../../../../../../lib/api/errors.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRESHNESS_THRESHOLD_SECONDS = 15;

export async function GET(
  request: Request,
  context: { params: Promise<{ chamberId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { chamberId } = await context.params;

    const url = new URL(request.url);
    const filterDeviceId = url.searchParams.get('deviceId');

    const chamber = await prisma.chamber.findFirst({
      where: UUID_REGEX.test(chamberId) ? { id: chamberId } : { code: chamberId },
      include: {
        assignments: {
          where: { activeUntil: null },
          include: {
            device: true,
          },
        },
      },
    });

    if (!chamber) {
      throw notFound(`Chamber "${chamberId}" not found`);
    }

    let activeDevices = chamber.assignments.map((a) => a.device);
    if (filterDeviceId) {
      activeDevices = activeDevices.filter(
        (d) => d.id === filterDeviceId || d.mqttDeviceId === filterDeviceId
      );
    }

    const now = Date.now();
    const deviceStatuses = await Promise.all(
      activeDevices.map(async (device) => {
        // Find latest eligible known-time reading
        const latestReading = await prisma.sensorReading.findFirst({
          where: {
            chamberId: chamber.id,
            deviceId: device.id,
            measurementTimeQuality: { in: ['SYNCED', 'RECONSTRUCTED'] },
            measuredAt: { not: null },
          },
          orderBy: [
            { measuredAt: 'desc' },
            { receivedAt: 'desc' },
            { historySequence: 'desc' },
          ],
        });

        // Compute freshness exclusively from measuredAt
        let freshnessState: 'fresh' | 'stale' | 'unknown' = 'unknown';
        let ageSeconds: number | null = null;

        if (latestReading && latestReading.measuredAt) {
          ageSeconds = Math.max(0, Math.floor((now - latestReading.measuredAt.getTime()) / 1000));
          freshnessState = ageSeconds <= FRESHNESS_THRESHOLD_SECONDS ? 'fresh' : 'stale';
        }

        return {
          device: {
            id: device.id,
            mqttDeviceId: device.mqttDeviceId,
            name: device.name,
          },
          connection: {
            state: device.connectionState,
            evidence: device.connectionEvidence,
            bootId: device.currentBootId,
            sessionId: device.currentSessionId,
            lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
            statusProcessedAt: device.lastStatusProcessedAt
              ? device.lastStatusProcessedAt.toISOString()
              : null,
          },
          freshness: {
            state: freshnessState,
            ageSeconds,
            thresholdSeconds: FRESHNESS_THRESHOLD_SECONDS,
          },
          reading: latestReading
            ? {
                id: latestReading.id,
                measuredAt: latestReading.measuredAt ? latestReading.measuredAt.toISOString() : null,
                receivedAt: latestReading.receivedAt.toISOString(),
                measurementTimeQuality: latestReading.measurementTimeQuality,
                values: {
                  temperatureC: {
                    value: latestReading.temperatureC !== null ? Number(latestReading.temperatureC) : null,
                    unit: '°C',
                    quality: latestReading.temperatureQuality,
                  },
                  humidityPercent: {
                    value: latestReading.humidityPercent !== null ? Number(latestReading.humidityPercent) : null,
                    unit: '%RH',
                    quality: latestReading.humidityQuality,
                  },
                  mq137Raw: {
                    value: latestReading.mq137Raw !== null ? Number(latestReading.mq137Raw) : null,
                    unit: 'raw',
                    quality: latestReading.mq137Quality,
                  },
                  mq136Raw: {
                    value: latestReading.mq136Raw !== null ? Number(latestReading.mq136Raw) : null,
                    unit: 'raw',
                    quality: latestReading.mq136Quality,
                  },
                  mq4Raw: {
                    value: latestReading.mq4Raw !== null ? Number(latestReading.mq4Raw) : null,
                    unit: 'raw',
                    quality: latestReading.mq4Quality,
                  },
                },
              }
            : null,
        };
      })
    );

    return jsonResponse({
      chamber: {
        id: chamber.id,
        code: chamber.code,
        name: chamber.name,
      },
      devices: deviceStatuses,
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
