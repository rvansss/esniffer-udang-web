/**
 * Kalibrasi sensor sebelum rekam langsung di detail batch.
 *
 * Dulu operator mencentang checkbox "warmup 30 menit": durasinya tetap dan
 * tidak ada bukti waktu bahwa sensornya benar-benar didiamkan. Sekarang durasi
 * diisi operator, dihitung mundur, dan tombol Start Tahap terkunci sampai
 * hitungannya habis.
 *
 * Dua hal disimpan di localStorage (bukan server):
 * - riwayat durasi, dipakai sebagai pilihan cepat agar operator tidak mengetik
 *   ulang angka yang sama;
 * - kalibrasi yang sedang berjalan, supaya muat ulang halaman tidak mereset
 *   hitungan.
 *
 * Durasi kalibrasi tidak masuk dataset: kontrak API tetap hanya menerima
 * `warmupDone` (lihat POST /api/v1/groups/:groupId/sessions). Kalau nanti
 * angkanya perlu ikut terekam, itu perubahan skema DB + ekspor CSV, bukan
 * sekadar UI.
 */

/** Durasi bawaan saat belum ada riwayat — sama dengan aturan warmup lama. */
export const CALIBRATION_DEFAULT_MINS = 30;

/** Batas teknis isian; sama dengan batas durasi pengujian supaya konsisten. */
export const CALIBRATION_MIN_MINS = 1;
export const CALIBRATION_MAX_MINS = 120;

/** Jumlah pilihan cepat yang ditawarkan; terbaru lebih dulu. */
export const CALIBRATION_HISTORY_LIMIT = 4;

const HISTORY_KEY = 'esniffer:calibration:history-v1';
const RUN_KEY_PREFIX = 'esniffer:calibration:run-v1:';

/** Kalibrasi yang sedang berjalan (atau baru selesai) untuk satu grup. */
export interface CalibrationRun {
  /** Durasi pilihan operator, menit bilangan bulat. */
  mins: number;
  /** Waktu mulai (epoch ms) — dasar hitungan mundur dan pemulihan. */
  startedAtMs: number;
}

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Penjelajah mode privat/kuota penuh boleh melempar; fitur lalu jalan
    // tanpa ingatan, bukan gagal.
    return null;
  }
};

/**
 * Angka durasi yang sah: bilangan bulat 1..120 menit. `null` untuk isian
 * kosong, pecahan, atau di luar batas — pemanggil yang memutuskan pesannya.
 */
export function normalizeCalibrationMins(value: unknown): number | null {
  const mins = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof mins !== 'number' || !Number.isInteger(mins)) return null;
  return mins >= CALIBRATION_MIN_MINS && mins <= CALIBRATION_MAX_MINS ? mins : null;
}

/** Riwayat durasi yang pernah dipakai, terbaru lebih dulu. */
export function readCalibrationHistory(): number[] {
  try {
    const raw = storage()?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    for (const item of parsed) {
      const mins = normalizeCalibrationMins(item);
      if (mins !== null) seen.add(mins);
    }
    return [...seen].slice(0, CALIBRATION_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Catat durasi yang dipakai lalu kembalikan riwayat terbaru. Nilai yang sama
 * dipindah ke depan, bukan diduplikasi; daftar dipotong ke batas pilihan cepat.
 */
export function rememberCalibrationMins(mins: number | string): number[] {
  const normalized = normalizeCalibrationMins(mins);
  const current = readCalibrationHistory();
  if (normalized === null) return current;
  const next = [normalized, ...current.filter((m) => m !== normalized)].slice(
    0,
    CALIBRATION_HISTORY_LIMIT
  );
  try {
    storage()?.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Tanpa localStorage: chip tetap tampil untuk sesi ini, hanya tidak diingat.
  }
  return next;
}

/** Kunci penyimpanan kalibrasi berjalan; satu kunci per batch + grup. */
export function calibrationRunKey(batchId: string, groupId: string): string {
  return `${RUN_KEY_PREFIX}${batchId}:${groupId}`;
}

/** Kalibrasi berjalan yang tersimpan, atau `null` bila tidak ada/rusak. */
export function readCalibrationRun(key: string): CalibrationRun | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const run = parsed as Partial<CalibrationRun>;
    const mins = normalizeCalibrationMins(run.mins);
    if (mins === null || typeof run.startedAtMs !== 'number' || !Number.isFinite(run.startedAtMs)) {
      return null;
    }
    return { mins, startedAtMs: run.startedAtMs };
  } catch {
    return null;
  }
}

export function writeCalibrationRun(key: string, run: CalibrationRun): void {
  try {
    storage()?.setItem(key, JSON.stringify(run));
  } catch {
    // Tanpa localStorage: hitungan tetap jalan di memori.
  }
}

export function clearCalibrationRun(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Abaikan.
  }
}

/** Sisa waktu kalibrasi (ms). 0 = belum dimulai atau sudah habis. */
export function calibrationRemainingMs(run: CalibrationRun | null, nowMs: number): number {
  if (!run) return 0;
  return Math.max(0, run.startedAtMs + run.mins * 60_000 - nowMs);
}

/**
 * Selesai hanya bila kalibrasi sudah dimulai DAN hitungannya habis. Belum
 * dimulai berarti belum selesai — itu yang mengunci tombol Start Tahap.
 */
export function calibrationDone(run: CalibrationRun | null, nowMs: number): boolean {
  if (!run) return false;
  return nowMs - run.startedAtMs >= run.mins * 60_000;
}

/** Hitungan mundur `mm:ss`; jam ikut tampil bila durasi ≥ 60 menit. */
export function formatCalibrationCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
