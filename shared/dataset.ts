/**
 * Validasi domain murni untuk pencatatan protokol dataset (PRD §3, GATE A–D).
 * Tanpa I/O: dipakai API (Fase 3) dan UI wizard (Fase 5) sebagai satu sumber kebenaran.
 * Istilah CSV/DB dipertahankan English snake_case; pesan error Indonesia dibuat di lapisan API/UI.
 */

export class DatasetValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DatasetValidationError';
    this.code = code;
  }
}

// WIB = UTC+7, tanpa DST. Offset dibuat eksplisit agar tidak bergantung TZ server.
export const WIB_OFFSET_MINUTES = 7 * 60;

// Batas foto MVP (PRD §3.1): maks 10 file @5MB.
export const MAX_BATCH_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const BATCH_ID_PATTERN = /^BT-\d{8}-\d{2}$/;
export const GROUP_ID_PATTERN = /^BT-\d{8}-\d{2}-(SR|SD)$/;
export const SESSION_ID_PATTERN = /^SES-\d{8}-[A-Z0-9]{1,8}-(SR|SD)$/;
export const TIMEPOINT_PATTERN = /^(H|D)([0-9]+)$/;

export type StorageConditionCode = 'room_temp' | 'cold';

const STORAGE_SUFFIX: Record<StorageConditionCode, 'SR' | 'SD'> = {
  room_temp: 'SR',
  cold: 'SD',
};

/** Urutan timepoint baku per kondisi simpan (satu sumber kebenaran untuk UI + validasi). */
export const TIMEPOINT_SEQUENCES: Record<StorageConditionCode, readonly string[]> = {
  room_temp: ['H0', 'H6', 'H12', 'H18', 'H24', 'H30', 'H36', 'H42', 'H48'],
  cold: ['H0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14'],
};

export function isValidBatchId(value: unknown): value is string {
  return typeof value === 'string' && BATCH_ID_PATTERN.test(value);
}

export function isValidGroupId(value: unknown): value is string {
  return typeof value === 'string' && GROUP_ID_PATTERN.test(value);
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

/** Ambil cap tanggal YYYYMMDD dalam zona WIB dari sebuah Date. */
export function wibDateStamp(date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MINUTES * 60_000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Auto-generate batch_id server-side: BT-YYYYMMDD-NN. */
export function buildBatchId(now: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) {
    throw new DatasetValidationError('INVALID_BATCH_SEQUENCE', 'Nomor urut batch harus 1–99');
  }
  return `BT-${wibDateStamp(now)}-${String(sequence).padStart(2, '0')}`;
}

/** Auto-generate group_id dari batch + kondisi simpan. */
export function buildGroupId(batchId: string, storage: StorageConditionCode): string {
  if (!isValidBatchId(batchId)) {
    throw new DatasetValidationError('INVALID_BATCH_ID', `batch_id tidak valid: ${batchId}`);
  }
  const suffix = STORAGE_SUFFIX[storage];
  if (!suffix) {
    throw new DatasetValidationError('INVALID_STORAGE', `storage_condition tidak dikenal: ${storage}`);
  }
  return `${batchId}-${suffix}`;
}

/** Auto-generate session_id dari tanggal, timepoint, dan suffix grup (SR/SD). */
export function buildSessionId(now: Date, timepointCode: string, groupSuffix: 'SR' | 'SD'): string {
  const parsed = parseTimepointCode(timepointCode); // validasi format sekalian
  const tp = `${parsed.kind}${parsed.value}`;
  return `SES-${wibDateStamp(now)}-${tp}-${groupSuffix}`;
}

export interface ParsedTimepoint {
  kind: 'H' | 'D';
  value: number;
}

/** Parse timepoint_code (H0/H6/D1…) atau throw. */
export function parseTimepointCode(code: string): ParsedTimepoint {
  const match = TIMEPOINT_PATTERN.exec(code);
  if (!match) {
    throw new DatasetValidationError('INVALID_TIMEPOINT', `timepoint_code tidak valid: ${code}`);
  }
  return { kind: match[1] as 'H' | 'D', value: Number.parseInt(match[2], 10) };
}

/** Konversi timepoint ke jam elapsed: H=jam, D=hari×24. */
export function timepointToElapsedHours(code: string): number {
  const parsed = parseTimepointCode(code);
  return parsed.kind === 'H' ? parsed.value : parsed.value * 24;
}

/** Bandingkan dua timepoint berdasarkan elapsed_hours. */
export function compareTimepoints(a: string, b: string): -1 | 0 | 1 {
  const elapsedA = timepointToElapsedHours(a);
  const elapsedB = timepointToElapsedHours(b);
  if (elapsedA < elapsedB) return -1;
  if (elapsedA > elapsedB) return 1;
  return 0;
}

/** Timepoint berikutnya harus strictly monoton naik dalam satu grup (GATE C/D). */
export function isNextTimepoint(previous: string, next: string): boolean {
  return compareTimepoints(previous, next) === -1;
}

/** Durasi transport dalam milidetik; negatif bila urutan waktu terbalik. */
export function transportDurationMs(departedAtUtc: Date, arrivedAtUtc: Date): number {
  return arrivedAtUtc.getTime() - departedAtUtc.getTime();
}

/** Kepatuhan cold-chain: durasi ≤ maxHours (default 3 jam, PRD Tahap B). */
export function isColdChainCompliant(
  departedAtUtc: Date,
  arrivedAtUtc: Date,
  maxHours = 3
): boolean {
  const duration = transportDurationMs(departedAtUtc, arrivedAtUtc);
  return duration >= 0 && duration <= maxHours * 3_600_000;
}

/** Susut berat dalam persen vs berat pasar; negatif berarti bertambah (anomali). */
export function shrinkagePercent(marketWeightG: number, labWeightG: number): number {
  if (!(marketWeightG > 0)) {
    throw new DatasetValidationError('INVALID_WEIGHT', 'Berat pasar harus > 0');
  }
  return ((marketWeightG - labWeightG) / marketWeightG) * 100;
}

/** Susut dapat diterima bila 0–maxPct% (default 5%, PRD Tahap C). */
export function isShrinkageAcceptable(
  marketWeightG: number,
  labWeightG: number,
  maxPct = 5
): boolean {
  const pct = shrinkagePercent(marketWeightG, labWeightG);
  return pct >= 0 && pct <= maxPct;
}

/**
 * Parse input form "YYYY-MM-DD HH:mm" sebagai waktu WIB → Date UTC.
 * Contoh: "2026-10-02 07:00" (WIB) → 2026-10-02T00:00:00.000Z.
 */
export function wibInputToUtc(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) {
    throw new DatasetValidationError(
      'INVALID_DATETIME',
      `Format harus YYYY-MM-DD HH:mm, contoh 2026-10-02 07:00 (diterima: ${input})`
    );
  }
  const [, y, mo, d, h, mi] = match.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
    throw new DatasetValidationError('INVALID_DATETIME', `Tanggal/jam tidak valid: ${input}`);
  }
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - WIB_OFFSET_MINUTES * 60_000);
}

/** Label ganda untuk UI: "07:00 WIB → tersimpan 00:00 UTC". */
export function formatWibLabel(dateUtc: Date): string {
  const wib = new Date(dateUtc.getTime() + WIB_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const wibStr = `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())} WIB`;
  return `${wibStr} → tersimpan ${dateUtc.toISOString()}`;
}

/** Jendela pengadaan 06:00–08:00 WIB (PRD Tahap A), dinilai dari Date UTC. */
export function isProcurementWindow(dateUtc: Date): boolean {
  const wibHour =
    (dateUtc.getUTCHours() + WIB_OFFSET_MINUTES / 60) % 24;
  const wibMinute = dateUtc.getUTCMinutes();
  const totalMinutes = wibHour * 60 + wibMinute;
  return totalMinutes >= 6 * 60 && totalMinutes <= 8 * 60;
}
