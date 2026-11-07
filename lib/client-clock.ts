/**
 * Jam server di sisi klien — satu sumber "sekarang" untuk semua hitungan
 * mundur di browser.
 *
 * Yang disimpan server adalah WAKTU MULAI ABSOLUT tiap langkah kalibrasi dan
 * tiap sesi berjalan (`startedAtUtc`). Kalau klien mengurangkannya dengan
 * `Date.now()` perangkat, selisih jam dua perangkat langsung menjadi selisih
 * hitungan: laptop yang jamnya tertinggal 20 detik menampilkan "30:20" padahal
 * durasinya 30 menit, dan HP yang jamnya mendahului 45 detik menampilkan
 * "29:15" pada saat yang sama.
 *
 * Modul ini menutup celah itu: setiap respons API membawa header
 * `x-server-time` (lihat `lib/api/response.ts`), lalu `apiFetch` memanggil
 * `applyServerTimeFromHeader`. Hitungan di halaman memakai `serverNowMs()` —
 * jam perangkat + selisih yang terukur — sehingga semua perangkat menghitung
 * dari jam yang sama.
 *
 * Modul ini murni (tanpa DOM, tanpa Node) supaya bisa diuji `test:unit`.
 */

/** Selisih jam yang tidak masuk akal (mis. sampel rusak) diabaikan. */
const MAX_PLAUSIBLE_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Sampel yang lebih tua dari ini diganti walau RTT-nya lebih baik, supaya
 * pergeseran jam perangkat (NTP menyesuaikan waktu) tetap terikuti.
 */
const SAMPLE_STALE_AFTER_MS = 120_000;

interface ClockSample {
  /** Perkiraan `jam server − jam perangkat` (ms). */
  offsetMs: number;
  /** Round-trip permintaan yang menghasilkan sampel ini (ms). */
  rttMs: number;
  /** Jam perangkat saat sampel diterima; untuk menilai sampel basi. */
  atLocalMs: number;
}

let sample: ClockSample | null = null;
const listeners = new Set<() => void>();

/** Offset yang sedang berlaku; 0 berarti jam perangkat dipakai apa adanya. */
export function serverClockOffsetMs(): number {
  return sample?.offsetMs ?? 0;
}

/** Jam server versi klien (epoch ms). `atLocalMs` hanya dipakai test. */
export function serverNowMs(atLocalMs: number = Date.now()): number {
  return atLocalMs + serverClockOffsetMs();
}

/** Apakah sudah pernah ada sampel jam server yang sah. */
export function hasServerClock(): boolean {
  return sample !== null;
}

/**
 * Mendaftarkan pendengar perubahan jam. Dipakai `useServerNow` agar hitungan
 * langsung memakai offset baru saat respons datang, bukan menunggu tick
 * berikutnya. Mengembalikan fungsi berhenti berlangganan.
 */
export function subscribeClientClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Pendengar yang error tidak boleh menghentikan sinkronisasi lain.
    }
  }
}

/**
 * Menyimpan sampel jam server dari satu respons.
 *
 * `sentLocalMs`/`receivedLocalMs` adalah jam perangkat sebelum permintaan
 * dikirim dan sesudah respons diterima. Titik tengahnya dipakai sebagai
 * perkiraan saat server menjawab, sehingga keterlambatan jaringan tidak
 * membuat hitungan maju/mundur. Sampel dengan RTT terkecil dipertahankan
 * karena paling sedikit mengandung waktu proses server.
 *
 * Nilai tidak masuk akal (bukan angka, offset > 7 hari) diabaikan: lebih baik
 * memakai sampel lama daripada melompat karena header rusak.
 */
export function applyServerTime(
  serverMs: number,
  sentLocalMs: number,
  receivedLocalMs: number
): void {
  if (!Number.isFinite(serverMs) || serverMs <= 0) return;
  if (!Number.isFinite(sentLocalMs) || !Number.isFinite(receivedLocalMs)) return;

  const received = Math.max(sentLocalMs, receivedLocalMs);
  const rttMs = Math.max(0, received - sentLocalMs);
  const offsetMs = Math.round(serverMs - (sentLocalMs + received) / 2);
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > MAX_PLAUSIBLE_OFFSET_MS) return;

  const previousOffset = serverClockOffsetMs();
  const stale = sample === null || received - sample.atLocalMs > SAMPLE_STALE_AFTER_MS;
  const faster = sample !== null && rttMs <= sample.rttMs;
  if (!stale && !faster) return;

  sample = { offsetMs, rttMs, atLocalMs: received };
  // Re-render hanya bila angka yang dipakai hitungan benar-benar berubah.
  if (offsetMs !== previousOffset) notify();
}

/** Sampel dari header `x-server-time` (epoch ms sebagai string). */
export function applyServerTimeFromHeader(
  headerValue: string | null | undefined,
  sentLocalMs: number,
  receivedLocalMs: number
): void {
  if (typeof headerValue !== 'string' || headerValue.trim() === '') return;
  const serverMs = Number(headerValue.trim());
  if (!Number.isFinite(serverMs)) return;
  applyServerTime(serverMs, sentLocalMs, receivedLocalMs);
}

/** Mengosongkan sampel. Hanya dipakai test. */
export function resetClientClockForTests(): void {
  sample = null;
  listeners.clear();
}
