import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { parseIsoDate, validateTimeRange } from '../../../../../../lib/api/validation.ts';
import { notFound, validationError } from '../../../../../../lib/api/errors.ts';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const ALLOWED_METRICS: Record<string, string> = {
  temperatureC: 'temperature_c',
  humidityPercent: 'humidity_percent',
  mq137Raw: 'mq137_raw',
  mq136Raw: 'mq136_raw',
  mq4Raw: 'mq4_raw',
};

const BUCKET_INTERVALS: Record<string, { interval: string; seconds: number }> = {
  '5s': { interval: '5 seconds', seconds: 5 },
  '30s': { interval: '30 seconds', seconds: 30 },
  '1m': { interval: '1 minute', seconds: 60 },
  '5m': { interval: '5 minutes', seconds: 300 },
  '15m': { interval: '15 minutes', seconds: 900 },
  '1h': { interval: '1 hour', seconds: 3600 },
  '6h': { interval: '6 hours', seconds: 21600 },
  '24h': { interval: '1 day', seconds: 86400 },
  '1d': { interval: '1 day', seconds: 86400 },
};

function resolveAutoBucket(rangeSeconds: number): string {
  if (rangeSeconds <= 5000) return '5s';
  if (rangeSeconds <= 30000) return '30s';
  if (rangeSeconds <= 60000) return '1m';
  if (rangeSeconds <= 300000) return '5m';
  if (rangeSeconds <= 900000) return '15m';
  if (rangeSeconds <= 3600000) return '1h';
  if (rangeSeconds <= 21600000) return '6h';
  return '24h';
}

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
      throw validationError('Parameters "from" and "to" are required for series queries');
    }

    const fromDate = parseIsoDate(rawFrom, 'from', true)!;
    const toDate = parseIsoDate(rawTo, 'to', true)!;
    validateTimeRange(fromDate, toDate, MAX_RANGE_MS);

    // Resolve bucket
    const rawBucket = (url.searchParams.get('bucket') || 'auto').toLowerCase();
    const rangeSeconds = Math.floor((toDate.getTime() - fromDate.getTime()) / 1000);
    const chosenBucketKey = rawBucket === 'auto' ? resolveAutoBucket(rangeSeconds) : rawBucket;

    const bucketConfig = BUCKET_INTERVALS[chosenBucketKey];
    if (!bucketConfig) {
      throw validationError(
        `Invalid bucket "${rawBucket}". Allowed values: 5s, 30s, 1m, 5m, 15m, 1h, 6h, 24h, auto`
      );
    }

    // Check max buckets constraint (<= 1000 buckets)
    const expectedBuckets = rangeSeconds / bucketConfig.seconds;
    if (expectedBuckets > 1000) {
      throw validationError(
        `Time range produces ${Math.ceil(expectedBuckets)} buckets for interval "${chosenBucketKey}", which exceeds the maximum limit of 1000 buckets. Use a larger bucket or "auto".`
      );
    }

    // Resolve metrics
    const metricsParam = url.searchParams.get('metrics');
    const requestedMetrics = metricsParam
      ? metricsParam.split(',').map((m) => m.trim())
      : Object.keys(ALLOWED_METRICS);

    for (const m of requestedMetrics) {
      if (!ALLOWED_METRICS[m]) {
        throw validationError(
          `Unknown metric "${m}". Allowed metrics: ${Object.keys(ALLOWED_METRICS).join(', ')}`
        );
      }
    }

    const filterDeviceId = url.searchParams.get('deviceId');
    let deviceUuid: string | null = null;
    if (filterDeviceId) {
      if (UUID_REGEX.test(filterDeviceId)) {
        deviceUuid = filterDeviceId;
      } else {
        const dev = await prisma.device.findUnique({ where: { mqttDeviceId: filterDeviceId } });
        if (!dev) throw notFound(`Device "${filterDeviceId}" not found`);
        deviceUuid = dev.id;
      }
    }

    // Build SELECT clauses for aggregated metrics
    // CRITICAL: AVG, MIN, MAX in PostgreSQL ignore NULLs automatically.
    // If all values in a bucket are null, AVG/MIN/MAX return NULL.
    const selectParts: string[] = [
      `date_bin(INTERVAL '${bucketConfig.interval}', measured_at, TIMESTAMP '2000-01-01 00:00:00Z') AS bucket_start`,
      `COUNT(*) AS total_count`,
    ];

    for (const m of requestedMetrics) {
      const col = ALLOWED_METRICS[m];
      selectParts.push(
        `AVG(${col}) AS "${m}_avg"`,
        `MIN(${col}) AS "${m}_min"`,
        `MAX(${col}) AS "${m}_max"`,
        `COUNT(${col}) AS "${m}_valid"`,
        `(COUNT(*) - COUNT(${col})) AS "${m}_invalid"`
      );
    }

    const deviceFilterSql = deviceUuid
      ? Prisma.sql`AND device_id = ${deviceUuid}::uuid`
      : Prisma.empty;

    const rawRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT
        ${Prisma.raw(selectParts.join(', '))}
      FROM sensor_readings
      WHERE chamber_id = ${chamber.id}::uuid
        AND measurement_time_quality IN ('SYNCED', 'RECONSTRUCTED')
        AND measured_at >= ${fromDate}
        AND measured_at <= ${toDate}
        ${deviceFilterSql}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC;
    `);

    const buckets = rawRows.map((row) => {
      const start = row.bucket_start instanceof Date ? row.bucket_start.toISOString() : String(row.bucket_start);
      const metrics: Record<string, unknown> = {};

      for (const m of requestedMetrics) {
        const avg = row[`${m}_avg`];
        const min = row[`${m}_min`];
        const max = row[`${m}_max`];
        const validCount = Number(row[`${m}_valid`] || 0);
        const invalidCount = Number(row[`${m}_invalid`] || 0);

        metrics[m] = {
          avg: avg !== null && avg !== undefined ? Number(avg) : null,
          min: min !== null && min !== undefined ? Number(min) : null,
          max: max !== null && max !== undefined ? Number(max) : null,
          validCount,
          invalidCount,
        };
      }

      return {
        bucketStart: start,
        totalCount: Number(row.total_count || 0),
        metrics,
      };
    });

    return jsonResponse(buckets, {
      chamber: { id: chamber.id, code: chamber.code, name: chamber.name },
      bucket: chosenBucketKey,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      bucketCount: buckets.length,
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
