"use client";

import { useEffect, useState } from 'react';
import { serverNowMs, subscribeClientClock } from '../lib/client-clock.ts';

/**
 * "Sekarang" menurut jam server, di-tick tiap `intervalMs`.
 *
 * Halaman memakai nilai ini untuk semua hitungan mundur (kalibrasi, sesi
 * berjalan, auto-complete) supaya dua perangkat tidak lagi berbeda karena jam
 * masing-masing. Offset jam diisi `apiFetch` dari header `x-server-time`
 * (lihat `lib/client-clock.ts`); saat offset baru masuk, hook ini langsung
 * memakai nilai barunya tanpa menunggu tick berikutnya.
 */
export function useServerNow(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => serverNowMs());

  useEffect(() => {
    const tick = () => setNowMs(serverNowMs());
    const timer = setInterval(tick, intervalMs);
    // Sampel jam baru datang (respons API) → tampilkan angka yang sudah
    // tersinkron segera, bukan satu detik kemudian.
    const unsubscribe = subscribeClientClock(tick);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [intervalMs]);

  return nowMs;
}
