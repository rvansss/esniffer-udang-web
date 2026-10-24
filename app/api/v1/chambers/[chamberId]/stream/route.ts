import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../lib/auth/guard.ts';
import { errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound } from '../../../../../../lib/api/errors.ts';
import { logger } from '../../../../../../lib/logging/logger.ts';
import { onWebShutdown } from '../../../../../../lib/runtime/shutdown.ts';
import type { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Jeda cek database. 500 ms = target keterlambatan server ke layar. */
const POLL_MS = 500;
/** Komentar penjaga koneksi agar proxy tak menutup stream diam. */
const HEARTBEAT_MS = 15_000;
const BATCH_SIZE = 50;

interface TickPayload {
  historySequence: string;
  device: { id: string; mqttDeviceId: string; name: string };
  measuredAt: string;
  receivedAt: string;
  measurementTimeQuality: string;
  values: {
    temperatureC: { value: number | null; unit: string; quality: string };
    humidityPercent: { value: number | null; unit: string; quality: string };
    mq137Raw: { value: number | null; unit: string; quality: string };
    mq136Raw: { value: number | null; unit: string; quality: string };
    mq4Raw: { value: number | null; unit: string; quality: string };
  };
}

type TickRow = Prisma.SensorReadingGetPayload<{
  include: { device: { select: { id: true; mqttDeviceId: true; name: true } } };
}>;

const num = (v: { toNumber(): number } | null): number | null => (v === null ? null : v.toNumber());

/**
 * GET /api/v1/chambers/[chamberId]/stream — dorong reading baru via SSE.
 *
 * Browser membuka SATU koneksi yang dibiarkan menyala (EventSource), server
 * memeriksa database tiap 500 ms dan menitipkan baris baru sebagai event
 * "tick". Param cursor = historySequence terakhir yang sudah diterima
 * browser; tanpa cursor, server mulai dari posisi terkini (tanpa replay).
 *
 * Ini pelengkap polling lama, bukan pengganti: bila koneksi putus, browser
 * kembali memakai /latest + /series seperti biasa.
 */
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
      select: { id: true, code: true },
    });
    if (!chamber) {
      throw notFound(`Chamber "${chamberId}" not found`);
    }

    const url = new URL(request.url);
    const rawCursor = url.searchParams.get('cursor');
    let cursor: bigint | null = null;
    if (rawCursor !== null && rawCursor !== '') {
      try {
        cursor = BigInt(rawCursor);
      } catch {
        cursor = null;
      }
    }
    if (cursor === null) {
      const latest = await prisma.sensorReading.findFirst({
        where: {
          chamberId: chamber.id,
          measurementTimeQuality: { in: ['SYNCED', 'RECONSTRUCTED'] },
        },
        orderBy: { historySequence: 'desc' },
        select: { historySequence: true },
      });
      cursor = latest?.historySequence ?? 0n;
    }
    // Posisi mutable untuk loop poll (bigint murni setelah titik ini).
    let pos: bigint = cursor ?? 0n;

    const encoder = new TextEncoder();
    const abortSignal = request.signal;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastHeartbeat = Date.now();
    let stopStream = () => {};

    const toTick = (r: TickRow): TickPayload => ({
      historySequence: String(r.historySequence ?? 0n),
      device: { id: r.device.id, mqttDeviceId: r.device.mqttDeviceId, name: r.device.name },
      measuredAt: r.measuredAt ? r.measuredAt.toISOString() : r.receivedAt.toISOString(),
      receivedAt: r.receivedAt.toISOString(),
      measurementTimeQuality: r.measurementTimeQuality,
      values: {
        temperatureC: { value: num(r.temperatureC), unit: '°C', quality: r.temperatureQuality },
        humidityPercent: { value: num(r.humidityPercent), unit: '%RH', quality: r.humidityQuality },
        mq137Raw: { value: num(r.mq137Raw), unit: 'raw', quality: r.mq137Quality },
        mq136Raw: { value: num(r.mq136Raw), unit: 'raw', quality: r.mq136Quality },
        mq4Raw: { value: num(r.mq4Raw), unit: 'raw', quality: r.mq4Quality },
      },
    });

    const stream = new ReadableStream({
      start(controller) {
        let unsubscribeShutdown = () => {};
        // Next.js menunggu request aktif sebelum exit. Tutup SSE saat SIGTERM
        // agar deploy tidak menunggu batas stop_grace_period Docker (45 detik).
        const stop = () => {
          if (stopped) return;
          stopped = true;
          if (timer) clearTimeout(timer);
          abortSignal.removeEventListener('abort', stop);
          unsubscribeShutdown();
          try { controller.close(); } catch { /* Stream mungkin sudah dibatalkan klien. */ }
        };
        stopStream = stop;
        abortSignal.addEventListener('abort', stop, { once: true });
        unsubscribeShutdown = onWebShutdown(stop);
        if (stopped || abortSignal.aborted) {
          stop();
          return;
        }
        controller.enqueue(encoder.encode(`event: ready\ndata: {"cursor":"${String(pos)}"}\n\n`));

        const poll = async () => {
          if (stopped || abortSignal.aborted) {
            stop();
            return;
          }
          try {
            const rows = await prisma.sensorReading.findMany({
              where: {
                chamberId: chamber.id,
                measurementTimeQuality: { in: ['SYNCED', 'RECONSTRUCTED'] },
                measuredAt: { not: null },
                historySequence: { gt: pos },
              },
              orderBy: { historySequence: 'asc' },
              take: BATCH_SIZE,
              include: { device: { select: { id: true, mqttDeviceId: true, name: true } } },
            });
            if (stopped) return;
            for (const row of rows) {
              if (row.historySequence !== null) {
                pos = row.historySequence;
              }
              controller.enqueue(
                encoder.encode(`event: tick\ndata: ${JSON.stringify(toTick(row))}\n\n`)
              );
            }
          } catch (err) {
            if (stopped) return;
            logger.error({
              service: 'web',
              operation: 'chamber_stream_poll',
              outcome: 'error',
              correlation_id: requestId,
              message: err instanceof Error ? err.message : String(err),
            });
          }

          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            try {
              controller.enqueue(encoder.encode(': ping\n\n'));
            } catch {}
          }

          if (!stopped && !abortSignal.aborted) {
            timer = setTimeout(() => void poll(), POLL_MS);
          } else {
            stop();
          }
        };

        void poll();
      },
      cancel() {
        stopStream();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'x-request-id': requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
