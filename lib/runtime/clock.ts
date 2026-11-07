/**
 * Sumber waktu server yang bisa diganti di test.
 *
 * Kalibrasi dan sesi memakai jam server, bukan jam perangkat: hitungan mundur
 * dihitung dari waktu mulai absolut, sehingga ponsel dan laptop menampilkan
 * sisa yang sama meskipun jam masing-masing berbeda. Supaya perilaku itu bisa
 * diuji tanpa menunggu 30 menit sungguhan, satu-satunya pemasok "sekarang"
 * untuk modul domain ada di sini dan bisa di-override oleh test.
 */

let overrideNowMs: (() => number) | null = null;

/** Waktu sekarang menurut server (epoch ms). */
export function nowMs(): number {
  return overrideNowMs ? overrideNowMs() : Date.now();
}

/** Waktu sekarang sebagai Date baru. */
export function nowDate(): Date {
  return new Date(nowMs());
}

/**
 * Mengganti sumber waktu. Hanya dipakai test (`test/api/calibration.test.ts`)
 * dan selalu dipulihkan dengan `setClockForTests(null)` pada `after()`.
 */
export function setClockForTests(fn: (() => number) | null): void {
  overrideNowMs = fn;
}
