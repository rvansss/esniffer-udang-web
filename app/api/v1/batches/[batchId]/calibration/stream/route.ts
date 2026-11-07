import { prisma } from '../../../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../../../lib/auth/guard.ts';
import { errorResponse, getRequestId } from '../../../../../../../lib/api/response.ts';
import { notFound } from '../../../../../../../lib/api/errors.ts';
import { logger } from '../../../../../../../lib/logging/logger.ts';
import { onWebShutdown } from '../../../../../../../lib/runtime/shutdown.ts';
import { nowMs } from '../../../../../../../lib/runtime/clock.ts';
import { loadBatchCalibrations } from '../../../../../../../lib/dataset/calibration.ts';
import type { CalibrationWire } from '../../../../../../../lib/calibration.ts';

/** Jeda cek database. 1 dtk = cukup untuk tombol yang ditekan operator lain. */
const POLL_MS = 1000;
/** Komentar penjaga koneksi agar proxy tak menutup stream diam (nginx 60 dtk). */
const HEARTBEAT_MS = 15_000;

/**
 * Isi satu event: state kalibrasi semua grup batch + jam server.
 *
 * `calibrations` selalu memuat SEMUA grup batch; grup yang belum/tidak lagi
 * punya baris kalibrasi dikirim `null`. Dengan begitu reset di satu perangkat
 * terlihat sebagai `null` di perangkat lain, bukan "data tidak berubah".
 */
interface CalibrationStreamPayload {
  serverTimeUtc: string;
  calibrations: Record<string, CalibrationWire | null>;
}

/**
 * GET /api/v1/batches/[batchId]/calibration/stream — dorong state kalibrasi
 * dua tahap via SSE.
 *
 * Halaman detail batch membuka SATU koneksi. Tanpa ini, perangkat lain baru
 * melihat kalibrasi yang dimulai di HP setelah polling 15 detik berikutnya —
 * sumber keluhan "harus di-refresh dulu". Server memeriksa `group_calibrations`
 * tiap detik dan hanya mengirim event saat sidik jari state berubah, jadi
 * hitungan di semua perangkat berangkat dari state yang sama.
 *
 * Polling detail batch tetap berjalan sebagai rekonsiliasi: bila koneksi ini
 * putus, halaman tidak kehilangan data, hanya kembali lambat.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { batchId } = await context.params;

    const batch = await prisma.collectionBatch.findUnique({
      where: { batchId },
      select: { batchId: true },
    });
    if (!batch) {
      throw notFound(`Batch "${batchId}" not found`);
    }

    const encoder = new TextEncoder();
    const abortSignal = request.signal;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastHeartbeat = Date.now();
    let stopStream = () => {};

    /** groupId batch + state kalibrasi terbaru, dalam bentuk wire. */
    const snapshot = async (): Promise<{
      payload: CalibrationStreamPayload;
      fingerprint: string;
    }> => {
      const [groups, calibrations] = await Promise.all([
        prisma.sampleGroup.findMany({ where: { batchId }, select: { groupId: true } }),
        loadBatchCalibrations(batchId),
      ]);
      const map: Record<string, CalibrationWire | null> = {};
      const parts: string[] = [];
      for (const group of groups) {
        const wire = calibrations.get(group.groupId) ?? null;
        map[group.groupId] = wire;
        parts.push(`${group.groupId}:${wire ? wire.version : 'none'}`);
      }
      parts.sort();
      return {
        payload: { serverTimeUtc: new Date(nowMs()).toISOString(), calibrations: map },
        fingerprint: parts.join('|'),
      };
    };

    const stream = new ReadableStream({
      start(controller) {
        let unsubscribeShutdown = () => {};
        // Next.js menunggu request aktif sebelum exit. Tutup SSE saat SIGTERM
        // agar deploy tidak menunggu batas stop_grace_period Docker.
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

        let lastFingerprint: string | null = null;

        const poll = async () => {
          if (stopped || abortSignal.aborted) {
            stop();
            return;
          }
          try {
            const { payload, fingerprint } = await snapshot();
            if (stopped) return;
            // Snapshot pertama SELALU dikirim (walau batch belum punya grup):
            // klien membutuhkannya untuk tahu koneksi hidup dan jam server.
            if (lastFingerprint === null || fingerprint !== lastFingerprint) {
              const isFirst = lastFingerprint === null;
              lastFingerprint = fingerprint;
              controller.enqueue(
                encoder.encode(
                  `event: ${isFirst ? 'snapshot' : 'state'}\ndata: ${JSON.stringify(payload)}\n\n`
                )
              );
            }
          } catch (err) {
            if (stopped) return;
            logger.error({
              service: 'web',
              operation: 'calibration_stream_poll',
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
