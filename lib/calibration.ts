/**
 * Kalibrasi sensor dua tahap — modul murni (tanpa localStorage, tanpa I/O).
 *
 * Protokolnya: chamber ditutup ±30 menit (sensor stabil), lalu chamber dibuka
 * ±5 menit sambil mengukur suhu udang dan menimbang beratnya. Dua langkah
 * berurutan itu dihitung mundur satu per satu; operator menekan tombol di awal
 * tiap langkah, karena hanya operator yang tahu kapan chamber benar-benar
 * dibuka/ditutup.
 *
 * Sejak Fase 0 state kalibrasi disimpan di server (`group_calibrations`): yang
 * disimpan adalah WAKTU MULAI ABSOLUT tiap langkah, bukan sisa detik. Dengan
 * begitu kalibrasi yang dimulai di ponsel langsung terlihat dan berlanjut di
 * laptop — sisa waktu dihitung ulang dari jam server di perangkat mana pun.
 *
 * Fungsi di berkas ini dipakai dua sisi sekaligus:
 * - server (`lib/dataset/calibration.ts`) untuk memvalidasi aksi dan memutuskan
 *   kapan kalibrasi selesai — klien tidak boleh mengklaim waktu;
 * - klien (`app/batches/[batchId]/page.tsx`) untuk menggambar hitungan mundur.
 *
 * Durasi kalibrasi tidak masuk dataset: kontrak API tetap hanya menerima
 * `warmupDone` (lihat POST /api/v1/groups/:groupId/sessions). Yang ikut
 * terekam adalah `calibrationCompletedAtUtc` sebagai bukti prasyarat.
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

/** Jumlah langkah; dipakai untuk memvalidasi bentuk data dari server. */
export const CALIBRATION_STEP_COUNT = CALIBRATION_STEPS.length;

/**
 * Kalibrasi satu grup dalam bentuk yang dipakai UI: durasi & waktu mulai tiap
 * langkah (epoch ms, `null` = belum dimulai). Bentuk ini sengaja tetap primitif
 * supaya semua hitungan di bawahnya berupa fungsi murni.
 */
export interface CalibrationRun {
  /** Durasi tiap langkah (menit) — sejajar `CALIBRATION_STEPS`. */
  mins: number[];
  /** Waktu mulai tiap langkah (epoch ms); `null` = belum dimulai. */
  starts: Array<number | null>;
}

/** Satu langkah dalam bentuk yang disimpan server (ISO, bukan epoch ms). */
export interface CalibrationStepWire {
  key: CalibrationStepKey;
  durationMins: number;
  startedAtUtc: string | null;
}

/**
 * Kalibrasi seperti yang dikirim API. `completedAtUtc` diisi server saat kedua
 * langkah benar-benar habis; `version` naik setiap perubahan sebagai penanda
 * urutan perubahan antar perangkat.
 */
export interface CalibrationWire {
  steps: CalibrationStepWire[];
  completedAtUtc: string | null;
  version: number;
  updatedAt: string;
  updatedByOperator: string | null;
  updatedByDevice: string | null;
}

export type CalibrationStepState = 'idle' | 'running' | 'done';

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
  return index === -1 ? CALIBRATION_STEP_COUNT : index;
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
  if (!Number.isInteger(index) || index < 0 || index >= CALIBRATION_STEP_COUNT) return null;
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
  return index === -1 ? CALIBRATION_STEP_COUNT : index;
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

function parseIsoMs(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Bentuk wire dari server → bentuk hitungan UI. `null` bila data tidak sesuai
 * skema (mis. jumlah langkah berubah setelah deploy): UI lalu menampilkan
 * "belum ada kalibrasi" alih-alih menghitung dari data yang tidak bisa dipercaya.
 */
export function runFromWire(wire: CalibrationWire | null | undefined): CalibrationRun | null {
  if (!wire || !Array.isArray(wire.steps) || wire.steps.length !== CALIBRATION_STEP_COUNT) {
    return null;
  }
  const mins: number[] = [];
  const starts: Array<number | null> = [];
  for (let i = 0; i < CALIBRATION_STEP_COUNT; i += 1) {
    const step = wire.steps[i];
    const expectedKey = CALIBRATION_STEPS[i].key;
    if (!step || step.key !== expectedKey) return null;
    const normalized = normalizeCalibrationMins(step.durationMins);
    if (normalized === null) return null;
    const startMs = parseIsoMs(step.startedAtUtc);
    if (startMs === undefined) return null;
    mins.push(normalized);
    starts.push(startMs);
  }
  return { mins, starts };
}

/** Bentuk hitungan UI → bentuk yang disimpan server. */
export function runToWireSteps(run: CalibrationRun): CalibrationStepWire[] {
  return CALIBRATION_STEPS.map((step, i) => {
    const start = run.starts[i] ?? null;
    return {
      key: step.key,
      durationMins: run.mins[i] ?? step.defaultMins,
      startedAtUtc: start === null ? null : new Date(start).toISOString(),
    };
  });
}

/**
 * Validasi `steps` yang tersimpan di DB (JSONB) sebelum dipakai menghitung.
 * Baris rusak dianggap "tidak ada kalibrasi" — lebih aman meminta operator
 * mengulang daripada membuka Start Tahap dari data yang tidak bisa dipercaya.
 */
export function runFromStoredSteps(value: unknown): CalibrationRun | null {
  if (!Array.isArray(value) || value.length !== CALIBRATION_STEP_COUNT) return null;
  const mins: number[] = [];
  const starts: Array<number | null> = [];
  for (let i = 0; i < CALIBRATION_STEP_COUNT; i += 1) {
    const step = value[i] as Partial<CalibrationStepWire> | null;
    if (!step || typeof step !== 'object') return null;
    if (step.key !== CALIBRATION_STEPS[i].key) return null;
    const normalized = normalizeCalibrationMins(step.durationMins);
    if (normalized === null) return null;
    const startMs = parseIsoMs(step.startedAtUtc);
    if (startMs === undefined) return null;
    mins.push(normalized);
    starts.push(startMs);
  }
  return { mins, starts };
}

/** Ringkasan satu baris untuk UI/banner: "chamber tertutup 30 mnt · chamber dibuka 5 mnt". */
export function describeCalibrationRun(run: CalibrationRun | null): string {
  if (!run) return 'Belum dimulai';
  return CALIBRATION_STEPS.map((step, i) => {
    const short = step.label.split('·')[1]?.trim() ?? step.key;
    return `${short} ${run.mins[i]} mnt`;
  }).join(' · ');
}
