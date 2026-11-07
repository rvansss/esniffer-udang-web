"use client";

import { useEffect, useState } from 'react';
import { applyServerTime } from '../lib/client-clock.ts';
import type { CalibrationWire } from '../lib/calibration.ts';

/**
 * State kalibrasi semua grup satu batch, seperti yang didorong server.
 * `calibrations` memuat semua grup; `null` = grup tanpa kalibrasi (belum
 * dimulai atau sudah di-reset).
 */
export interface BatchCalibrationState {
  serverTimeUtc: string;
  calibrations: Record<string, CalibrationWire | null>;
}

export type CalibrationStreamStatus = 'connecting' | 'live' | 'offline' | 'unsupported';

/**
 * Langganan SSE /batches/:batchId/calibration/stream.
 *
 * Kalibrasi dua tahap dikerjakan lintas perangkat (HP di chamber, laptop di
 * lab), jadi perubahan state harus sampai tanpa menunggu polling. Setiap event
 * juga membawa `serverTimeUtc` yang dipakai menyelaraskan jam klien sebelum
 * state-nya digambar, sehingga hitungan langsung berangkat dari jam server.
 *
 * Bila SSE tidak tersedia/putus, hook mengembalikan status `offline` dan
 * halaman tetap memakai polling detail batch seperti biasa.
 */
export function useBatchCalibrationStream(batchId: string | null) {
  const [state, setState] = useState<BatchCalibrationState | null>(null);
  const [status, setStatus] = useState<CalibrationStreamStatus>(() =>
    typeof EventSource === 'undefined' ? 'unsupported' : 'connecting'
  );

  useEffect(() => {
    if (!batchId || typeof EventSource === 'undefined') {
      return;
    }

    let stopped = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(
        `/api/v1/batches/${encodeURIComponent(batchId)}/calibration/stream`
      );
      setStatus('connecting');

      const receive = (event: Event) => {
        if (stopped) return;
        try {
          const body = JSON.parse((event as MessageEvent).data as string) as BatchCalibrationState;
          if (!body || typeof body !== 'object' || !body.calibrations) return;
          // Sampel jam: event datang dari server, waktu terima lokal dipakai
          // apa adanya (tanpa RTT) — cukup akurat dan sengaja konservatif.
          const receivedAtMs = Date.now();
          const serverMs = Date.parse(body.serverTimeUtc);
          if (Number.isFinite(serverMs)) {
            applyServerTime(serverMs, receivedAtMs, receivedAtMs);
          }
          setState(body);
          setStatus('live');
        } catch {
          // Payload rusak: abaikan, event berikutnya/polling tetap jalan.
        }
      };

      source.addEventListener('snapshot', receive);
      source.addEventListener('state', receive);

      source.onerror = () => {
        if (stopped) return;
        setStatus('offline');
        source?.close();
        // EventSource tidak selalu menyambung sendiri setelah proxy menutup
        // koneksi diam; sambung ulang sendiri seperti stream chamber.
        retryTimer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [batchId]);

  return {
    state,
    status: batchId ? status : ('offline' as CalibrationStreamStatus),
  };
}
