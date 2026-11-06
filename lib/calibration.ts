/**
 * Kalibrasi sensor dua tahap sebelum rekam langsung di detail batch.
 *
 * Protokolnya: chamber ditutup ±30 menit (sensor stabil), lalu chamber dibuka
 * ±5 menit sambil mengukur suhu udang dan menimbang beratnya. Dua langkah
 * berurutan itu dihitung mundur satu per satu; operator menekan tombol di awal
 * tiap langkah, karena hanya operator yang tahu kapan chamber benar-benar
 * dibuka/ditutup. Hitungan yang jalan otomatis akan mengklaim waktu yang tidak
 * pernah terjadi — persis kelemahan checkbox "warmup 30 menit" yang digantikan
 * modul ini.
 *
 * Waktu tunggu setelah udang masuk kembali ke chamber TIDAK dihitung di sini:
 * durasinya diisi operator di form tahap sebagai "Durasi pengujian".
 *
 * Start Tahap tetap terkunci sampai kedua langkah selesai. Dua hal disimpan di
 * localStorage (bukan server):
 * - durasi terakhir yang dipakai, supaya angka yang sama tidak diketik ulang;
 * - kalibrasi yang sedang berjalan, supaya muat ulang halaman tidak mereset
 *   hitungan.
 *
 * Durasi kalibrasi tidak masuk dataset: kontrak API tetap hanya menerima
 * `warmupDone` (lihat POST /api/v1/groups/:groupId/sessions). Kalau nanti
 * angkanya perlu ikut terekam, itu perubahan skema DB + ekspor CSV, bukan
 * sekadar UI.
 */

export type CalibrationStepKey = 'closed' | 'measure';

/** Satu langkah kalibrasi: label singkat, perintah kerja, durasi bawaan. */
export interface CalibrationStep {
  key: CalibrationStepKey;
  label: string;
  /** Yang harus dilakukan operator selama langkah ini berjalan. */
  instruction: string;
  defaultMins: number;
}

/**
 * Dua langkah kalibrasi: chamber tertutup (sensor stabil), lalu chamber dibuka
 * sambil mengukur suhu & menimbang udang.
 *
 * Langkah "udang masuk chamber lalu tunggu ±15 menit" sengaja BUKAN langkah di
 * sini: durasinya sudah diisi operator di form tahap ("Durasi pengujian",
 * bawaan 15 menit), dan tarif waktu yang sama di dua tempat hanya bikin dua
 * angka yang bisa bertentangan.
 */
export const CALIBRATION_STEPS: readonly CalibrationStep[] = [
  {
    key: 'closed',
    label: 'Tahap 1 · chamber tertutup',
    instruction: 'Tutup chamber dan diamkan sensor. Jangan buka sampai hitungan habis.',
    defaultMins: 30,
  },
  {
    key: 'measure',
    label: 'Tahap 2 · chamber dibuka',
    instruction:
      'Buka chamber, ukur suhu tiap udang dan timbang berat totalnya. Setelah itu masukkan udang kembali dan isi durasi pengujian di form tahap.',
    defaultMins: 5,
  },
];

/** Batas teknis isian; sama dengan batas durasi pengujian supaya konsisten. */
export const CALIBRATION_MIN_MINS = 1;
export const CALIBRATION_MAX_MINS = 120;

const DURATIONS_KEY = 'esniffer:calibration:durations-v2';
// Skema v2: satu `mins` dan satu `startedAtMs` per langkah. Kunci v1 sengaja
// tidak dibaca lagi — kalibrasi lama tidak punya jejak tahap 2, jadi lebih jujur
// meminta operator mengulang daripada menganggapnya selesai.
const RUN_KEY_PREFIX = 'esniffer:calibration:run-v2:';

/** Kalibrasi yang sedang berjalan (atau baru selesai) untuk satu grup. */
export interface CalibrationRun {
  /** Durasi tiap langkah (menit) — sejajar `CALIBRATION_STEPS`. */
  mins: number[];
  /** Waktu mulai tiap langkah (epoch ms); `null` = belum dimulai. */
  starts: Array<number | null>;
}

export type CalibrationStepState = 'idle' | 'running' | 'done';

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Penjelajah mode privat/kuota penuh boleh melempar; fitur lalu jalan
    // tanpa ingatan, bukan gagal.
    return null;
  }
};

const stepCount = CALIBRATION_STEPS.length;

/** Durasi bawaan protokol: 30 menit tertutup, 5 menit dibuka. */
export function defaultCalibrationDurations(): number[] {
  return CALIBRATION_STEPS.map((step) => step.defaultMins);
}

/**
 * Angka durasi yang sah: bilangan bulat 1..120 menit. `null` untuk isian
 * kosong, pecahan, atau di luar batas — pemanggil yang memutuskan pesannya.
 */
export function normalizeCalibrationMins(value: unknown): number | null {
  const mins = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof mins !== 'number' || !Number.isInteger(mins)) return null;
  return mins >= CALIBRATION_MIN_MINS && mins <= CALIBRATION_MAX_MINS ? mins : null;
}

/** Durasi terakhir yang dipakai operator; nilai rusak jatuh ke bawaan. */
export function readCalibrationDurations(): number[] {
  try {
    const raw = storage()?.getItem(DURATIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return CALIBRATION_STEPS.map(
      (step, i) => normalizeCalibrationMins(Array.isArray(parsed) ? parsed[i] : null) ?? step.defaultMins
    );
  } catch {
    return defaultCalibrationDurations();
  }
}

/** Simpan durasi yang baru dipakai sebagai nilai awal tahap berikutnya. */
export function saveCalibrationDurations(mins: readonly unknown[]): number[] {
  const normalized = CALIBRATION_STEPS.map(
    (step, i) => normalizeCalibrationMins(mins[i]) ?? step.defaultMins
  );
  try {
    storage()?.setItem(DURATIONS_KEY, JSON.stringify(normalized));
  } catch {
    // Tanpa localStorage: durasi tetap terpakai di sesi ini, hanya tidak diingat.
  }
  return normalized;
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
    if (!Array.isArray(run.mins) || !Array.isArray(run.starts)) return null;
    if (run.mins.length !== stepCount || run.starts.length !== stepCount) return null;
    const mins: number[] = [];
    for (const value of run.mins) {
      const minsValue = normalizeCalibrationMins(value);
      if (minsValue === null) return null;
      mins.push(minsValue);
    }
    const starts: Array<number | null> = [];
    for (const value of run.starts) {
      if (value === null) {
        starts.push(null);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        starts.push(value);
      } else {
        return null;
      }
    }
    return { mins, starts };
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

/**
 * Status satu langkah: `idle` belum dimulai, `running` hitungan jalan, `done`
 * hitungannya habis.
 */
export function calibrationStepState(
  run: CalibrationRun | null,
  index: number,
  nowMs: number
): CalibrationStepState {
  const start = run?.starts[index];
  if (start === null || start === undefined) return 'idle';
  const mins = run?.mins[index] ?? 0;
  return nowMs - start >= mins * 60_000 ? 'done' : 'running';
}

/** Sisa waktu satu langkah (ms). 0 = belum dimulai atau sudah habis. */
export function calibrationStepRemainingMs(
  run: CalibrationRun | null,
  index: number,
  nowMs: number
): number {
  const start = run?.starts[index];
  if (start === null || start === undefined) return 0;
  return Math.max(0, start + (run?.mins[index] ?? 0) * 60_000 - nowMs);
}

/** Langkah berikutnya yang belum dimulai; `stepCount` bila semua sudah dimulai. */
export function nextCalibrationStep(run: CalibrationRun | null): number {
  if (!run) return 0;
  const index = run.starts.findIndex((start) => start === null);
  return index === -1 ? stepCount : index;
}

/**
 * Mulai satu langkah. Ditolak (`null`) bila bukan langkah yang dijadwalkan
 * sekarang, atau langkah sebelumnya belum selesai — supaya hitungan tidak
 * melompati langkah yang terlewat.
 */
export function startCalibrationStep(
  run: CalibrationRun | null,
  index: number,
  mins: unknown,
  nowMs: number
): CalibrationRun | null {
  if (index < 0 || index >= stepCount) return null;
  const normalized = normalizeCalibrationMins(mins);
  if (normalized === null) return null;
  if (index !== nextCalibrationStep(run)) return null;
  if (index > 0 && calibrationStepState(run, index - 1, nowMs) !== 'done') return null;
  const starts = CALIBRATION_STEPS.map((_, i) => run?.starts[i] ?? null);
  const minsOfRun = CALIBRATION_STEPS.map((step, i) => run?.mins[i] ?? step.defaultMins);
  starts[index] = nowMs;
  minsOfRun[index] = normalized;
  return { mins: minsOfRun, starts };
}

/** Kalibrasi baru: hitungan langkah pertama mulai sekarang. */
export function startCalibration(durations: readonly unknown[], nowMs: number): CalibrationRun | null {
  const mins = CALIBRATION_STEPS.map(
    (step, i) => normalizeCalibrationMins(durations[i]) ?? step.defaultMins
  );
  return startCalibrationStep({ mins, starts: CALIBRATION_STEPS.map(() => null) }, 0, mins[0], nowMs);
}

/**
 * Selesai hanya bila semua langkah sudah dimulai DAN hitungannya habis. Belum
 * dimulai berarti belum selesai — itu yang mengunci tombol Start Tahap.
 */
export function calibrationDone(run: CalibrationRun | null, nowMs: number): boolean {
  if (!run) return false;
  return CALIBRATION_STEPS.every((_, i) => calibrationStepState(run, i, nowMs) === 'done');
}

/**
 * Langkah yang menahan Start Tahap sekarang; `stepCount` bila semua selesai.
 * Dipakai UI untuk menyebut langkah mana yang belum beres.
 */
export function pendingCalibrationStep(run: CalibrationRun | null, nowMs: number): number {
  if (!run) return 0;
  const index = CALIBRATION_STEPS.findIndex(
    (_, i) => calibrationStepState(run, i, nowMs) !== 'done'
  );
  return index === -1 ? stepCount : index;
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
