import { isShrimpType } from '../shared/shrimp.ts';
/**
 * Aturan validasi wizard batch baru (butir 12) — fungsi murni.
 *
 * Nilai form masuk sebagai string, hasil keluar peta `field → pesan galat`.
 * Dipisah dari komponen halaman supaya aturannya bisa diuji langsung di
 * suite unit dan tidak ikut mati bersama state React.
 */
import {
  COOLER_TEMP_MAX_C,
  COOLER_TEMP_MIN_C,
  DatasetValidationError,
  INITIAL_TEMP_MAX_C,
  INITIAL_TEMP_MIN_C,
  isColdChainCompliant,
  isProcurementWindow,
  transportDurationMs,
  wibInputToUtc,
} from '../shared/dataset.ts';

export type WizardErrors = Record<string, string>;

/** Pesan tunggal untuk ketiga titik waktu yang wajib di jendela pengadaan. */
const WINDOW_MESSAGE = 'Harus di antara 05:00–08:00 WIB (Anda mengisi jam di luar jendela).';

/** Nilai `sourceType` yang diakui kontrak API (lowercase). */
export const SOURCE_TYPE_VALUES = ['market', 'supermarket', 'farm'] as const;
export type SourceTypeValue = (typeof SOURCE_TYPE_VALUES)[number];

/** Nilai `visualCheck` yang diakui kontrak API (lowercase). */
export const VISUAL_CHECK_VALUES = ['normal', 'melanosis', 'damaged', 'mixed_species'] as const;

/**
 * Batas baris pengukuran per ekor yang dirender wizard. Pengaman UI: API tetap
 * menerima `shrimpCount` ≥ 10 berapa pun, tetapi mengetik 12 000 ekor tidak
 * boleh membuat halaman merender 24 000 input.
 */
export const SHRIMP_ROW_LIMIT = 100;

/**
 * Jumlah baris pengukuran per ekor yang layak dirender: 0 bila isian belum
 * berupa bilangan bulat 10..`SHRIMP_ROW_LIMIT` (mis. kosong, 9, 12.5, 101).
 */
export function shrimpRowCount(shrimpCount: string): number {
  const count = parseFormNumber(shrimpCount);
  if (count === null || !Number.isInteger(count)) return 0;
  return count >= 10 && count <= SHRIMP_ROW_LIMIT ? count : 0;
}

/**
 * Rata-rata isian form, dibulatkan 2 desimal — presisi yang diterima kolom
 * `DECIMAL(5,2)` dan `assertMeasurementPrecision` di API. `null` bila daftar
 * kosong atau ada isian kosong/bukan angka, supaya kolom turunan tidak pernah
 * menampilkan angka setengah jadi.
 */
export function meanFormNumber(values: readonly string[]): number | null {
  if (!values.length) return null;
  let total = 0;
  for (const value of values) {
    const parsed = parseFormNumber(value);
    if (parsed === null || Number.isNaN(parsed)) return null;
    total += parsed;
  }
  return Math.round((total / values.length) * 100) / 100;
}

/** Teks tampilan kolom turunan: kosong saat rata-rata belum bisa dihitung. */
export function formatMean(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * Nilai numerik dari input form: null bila kosong, NaN bila isian bukan
 * angka (pesan galat "bukan bilangan" lebih tepat daripada "wajib diisi").
 */
export function parseFormNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Parse input `datetime-local` sebagai waktu WIB → Date UTC. */
export function parseWibInput(value: string): { date?: Date; error?: string } {
  if (value.trim() === '') return { error: 'Wajib diisi.' };
  try {
    return { date: wibInputToUtc(value.replace('T', ' ')) };
  } catch {
    return { error: 'Format tanggal tidak valid.' };
  }
}

/**
 * Konversi input `datetime-local` berlabel WIB menjadi ISO UTC untuk disimpan.
 * Memakai interpretasi WIB yang sama dengan validasinya, bukan waktu lokal
 * device — supaya yang tersimpan sama dengan yang dilihat dan diuji.
 */
export function wibInputToUtcIso(value: string): string {
  const parsed = parseWibInput(value);
  if (!parsed.date) {
    throw new DatasetValidationError('INVALID_DATETIME', `Format tanggal tidak valid: ${value}`);
  }
  return parsed.date.toISOString();
}

/** Field milik langkah 1 — keberangkatan & sumber. */
export const STEP_A_FIELDS = ['departedAt', 'coolerDeparture', 'marketSource', 'sourceType'] as const;
/** Field milik langkah 2 — pembelian & kondisi udang (temuan visual ikut di sini). */
export const STEP_B_FIELDS = [
  'procuredAt',
  'initialCondition',
  'visualCheck',
  'shrimpType',
  'shrimpCount',
  'shrimpLengthCm',
  'totalWeightG',
  'initialTempC',
  'coolerMarket',
  'photos',
] as const;

/** Field dinamis pengukuran per ekor: `shrimpTemp-3`, `shrimpLength-12`, dst. */
export const SHRIMP_ROW_FIELD_PATTERN = /^shrimp(?:Temp|Length)-\d+$/;

/** Nomor langkah (0-based) yang memiliki sebuah field galat. */
export function stepOfField(key: string): number {
  if ((STEP_A_FIELDS as readonly string[]).includes(key)) return 0;
  if ((STEP_B_FIELDS as readonly string[]).includes(key)) return 1;
  if (SHRIMP_ROW_FIELD_PATTERN.test(key)) return 1;
  return 2;
}

export interface StepAInput {
  departedAt: string;
  coolerDeparture: string;
  marketSource: string;
  sourceType: string;
}

export interface StepBInput {
  procuredAt: string;
  departedAt: string;
  initialCondition?: string;
  shrimpType: string;
  shrimpCount: string;
  /** Form edit halaman detail: satu panjang untuk seluruh batch. */
  shrimpLengthCm?: string;
  /** Form edit halaman detail: satu suhu awal untuk seluruh batch. */
  initialTempC?: string;
  /** Wizard: pengukuran per ekor menggantikan dua field skalar di atas. */
  shrimpTemperatures?: string[];
  shrimpLengths?: string[];
  /** Wizard: temuan visual pindah ke langkah Kondisi Udang. */
  visualCheck?: string;
  totalWeightG: string;
  coolerMarket: string;
}

export interface GroupFormInput {
  labTempC?: string;
  visualCheck: string;
  labWeightBeforeG?: string;
  labWeightAfterG?: string;
  sampleShrimpCount: string;
}

/**
 * Langkah 1 — keberangkatan & sumber: jam berangkat (05:00–08:00 WIB), suhu
 * cool box saat berangkat, sumber (teks bebas), dan jenis sumber (dropdown).
 * Urutan berangkat → beli baru bisa diperiksa di langkah 2 karena jam beli
 * diisi di sana.
 */
export function validateStepA(input: StepAInput): WizardErrors {
  const e: WizardErrors = {};

  const dep = parseWibInput(input.departedAt);
  if (dep.error) {
    e.departedAt = dep.error;
  } else if (dep.date && !isProcurementWindow(dep.date)) {
    e.departedAt = WINDOW_MESSAGE;
  }

  const cooler = parseFormNumber(input.coolerDeparture);
  if (cooler === null) {
    e.coolerDeparture = 'Wajib diisi.';
  } else if (!(cooler >= COOLER_TEMP_MIN_C && cooler <= COOLER_TEMP_MAX_C)) {
    e.coolerDeparture = `Harus ${COOLER_TEMP_MIN_C} sampai ${COOLER_TEMP_MAX_C} °C.`;
  }

  const source = input.marketSource.trim();
  if (source === '') {
    e.marketSource = 'Wajib diisi.';
  } else if (source.length > 100) {
    e.marketSource = 'Maksimal 100 karakter.';
  }

  if (!(SOURCE_TYPE_VALUES as readonly string[]).includes(input.sourceType)) {
    e.sourceType = 'Wajib dipilih.';
  }

  return e;
}

/**
 * Langkah 2 — pembelian & kondisi udang: jam beli (05:00–08:00 WIB), urutan
 * berangkat < beli, jenis udang, temuan visual, lalu jumlah/berat udang dan
 * suhu cool box di pasar.
 *
 * Suhu awal dan panjang udang punya dua jalur:
 * - wizard mengirim `shrimpTemperatures`/`shrimpLengths` (pengukuran per ekor);
 *   tiap baris divalidasi sendiri dan nilai agregatnya diturunkan, bukan diketik;
 * - form edit halaman detail (dan pemanggil lama) mengirim `initialTempC` /
 *   `shrimpLengthCm` skalar, yang tetap divalidasi seperti sebelumnya.
 */
export function validateStepB(input: StepBInput): WizardErrors {
  const e: WizardErrors = {};

  const dep = parseWibInput(input.departedAt);
  const proc = parseWibInput(input.procuredAt);

  if (proc.error) {
    e.procuredAt = proc.error;
  } else if (proc.date && !isProcurementWindow(proc.date)) {
    e.procuredAt = WINDOW_MESSAGE;
  } else if (proc.date && dep.date && transportDurationMs(dep.date, proc.date) <= 0) {
    e.procuredAt = 'Tanggal dan jam beli harus setelah tanggal dan jam berangkat.';
  }

  if (!isShrimpType(input.shrimpType)) e.shrimpType = 'Wajib memilih Vaname atau Windu.';

  if (
    input.visualCheck !== undefined &&
    !(VISUAL_CHECK_VALUES as readonly string[]).includes(input.visualCheck)
  ) {
    e.visualCheck = 'Wajib dipilih.';
  }

  const temperatures = input.shrimpTemperatures;
  const lengths = input.shrimpLengths;
  const measuredPerShrimp = temperatures !== undefined && lengths !== undefined;

  const count = parseFormNumber(input.shrimpCount);
  if (count === null) {
    e.shrimpCount = 'Wajib diisi.';
  } else if (!Number.isInteger(count) || count < 10) {
    e.shrimpCount = 'Minimal 10 ekor (bilangan bulat).';
  } else if (measuredPerShrimp && count > SHRIMP_ROW_LIMIT) {
    e.shrimpCount = `Maksimal ${SHRIMP_ROW_LIMIT} ekor untuk pencatatan suhu & panjang per ekor.`;
  }

  if (temperatures && lengths) {
    const rows = shrimpRowCount(input.shrimpCount);
    for (let i = 0; i < rows; i += 1) {
      const key = i + 1;
      const temp = parseFormNumber(temperatures[i] ?? '');
      if (temp === null) {
        e[`shrimpTemp-${key}`] = 'Wajib diisi.';
      } else if (!(temp >= INITIAL_TEMP_MIN_C && temp <= INITIAL_TEMP_MAX_C)) {
        e[`shrimpTemp-${key}`] = `Harus ${INITIAL_TEMP_MIN_C} sampai ${INITIAL_TEMP_MAX_C} °C.`;
      }
      const len = parseFormNumber(lengths[i] ?? '');
      if (len === null) {
        e[`shrimpLength-${key}`] = 'Wajib diisi.';
      } else if (!(len >= 1 && len <= 50)) {
        e[`shrimpLength-${key}`] = 'Harus 1 sampai 50 cm.';
      }
    }
  } else {
    const len = parseFormNumber(input.shrimpLengthCm ?? '');
    if (len === null) {
      e.shrimpLengthCm = 'Wajib diisi.';
    } else if (!(len >= 1 && len <= 50)) {
      e.shrimpLengthCm = 'Harus 1 sampai 50 cm.';
    }

    const t = parseFormNumber(input.initialTempC ?? '');
    if (t === null) {
      e.initialTempC = 'Wajib diisi.';
    } else if (!(t >= INITIAL_TEMP_MIN_C && t <= INITIAL_TEMP_MAX_C)) {
      e.initialTempC = `Harus ${INITIAL_TEMP_MIN_C} sampai ${INITIAL_TEMP_MAX_C} °C.`;
    }
  }

  const w = parseFormNumber(input.totalWeightG);
  if (w === null) {
    e.totalWeightG = 'Wajib diisi.';
  } else if (!(w > 0) || w > 2000) {
    e.totalWeightG = 'Harus lebih dari 0 sampai 2000 gram.';
  }

  const cmarket = parseFormNumber(input.coolerMarket);
  if (cmarket === null) {
    e.coolerMarket = 'Wajib diisi.';
  } else if (!(cmarket >= COOLER_TEMP_MIN_C && cmarket <= COOLER_TEMP_MAX_C)) {
    e.coolerMarket = `Harus ${COOLER_TEMP_MIN_C} sampai ${COOLER_TEMP_MAX_C} °C.`;
  }

  return e;
}

/**
 * Aturan kolom grup — sumber tunggal untuk wizard batch baru maupun form edit
 * grup di halaman detail (butir 3: validasi tidak disalin).
 *
 * Jumlah udang per sesi punya dua bentuk masukan: satu nilai untuk kedua grup
 * (form edit halaman detail, `sampleShrimpCount`) atau terpisah suhu ruang /
 * suhu dingin (wizard, `sampleShrimpCountRoomTemp` + `sampleShrimpCountCold`).
 */
export interface StepCInput extends Omit<GroupFormInput, 'visualCheck' | 'sampleShrimpCount'> {
  procuredAt: string;
  arrivedAt: string;
  coolerLab: string;
  deviationAck: boolean;
  visualCheck?: string;
  sampleShrimpCount?: string;
  sampleShrimpCountRoomTemp?: string;
  sampleShrimpCountCold?: string;
}

export function validateStepC(input: StepCInput): WizardErrors {
  const perStorage =
    input.sampleShrimpCountRoomTemp !== undefined || input.sampleShrimpCountCold !== undefined;
  const e: WizardErrors = perStorage
    ? {}
    : validateGroupFields({
        ...input,
        visualCheck: input.visualCheck ?? '',
        sampleShrimpCount: input.sampleShrimpCount ?? '',
      });

  if (perStorage) {
    validateSampleCount(e, 'sampleShrimpCountRoomTemp', input.sampleShrimpCountRoomTemp);
    validateSampleCount(e, 'sampleShrimpCountCold', input.sampleShrimpCountCold);
  }

  const proc = parseWibInput(input.procuredAt);
  const arr = parseWibInput(input.arrivedAt);
  if (arr.error) {
    e.arrivedAt = arr.error;
  } else if (arr.date && !isProcurementWindow(arr.date)) {
    e.arrivedAt = WINDOW_MESSAGE;
  } else if (arr.date && proc.date) {
    if (transportDurationMs(proc.date, arr.date) <= 0) {
      e.arrivedAt = 'Tanggal dan jam tiba harus setelah tanggal dan jam beli.';
    } else if (!isColdChainCompliant(proc.date, arr.date) && !input.deviationAck) {
      e.arrivedAt = 'Melebihi 3 jam — centang deviasi di bawah untuk lanjut.';
    }
  }

  const clab = parseFormNumber(input.coolerLab);
  if (clab === null) {
    e.coolerLab = 'Wajib diisi.';
  } else if (!(clab >= COOLER_TEMP_MIN_C && clab <= COOLER_TEMP_MAX_C)) {
    e.coolerLab = `Harus ${COOLER_TEMP_MIN_C} sampai ${COOLER_TEMP_MAX_C} °C.`;
  }

  return e;
}

/** Aturan jumlah udang per sesi (3–5 ekor) untuk satu kunci error. */
function validateSampleCount(
  target: Record<string, string>,
  key: string,
  value: string | undefined
): void {
  const count = parseFormNumber(value ?? '');
  if (count === null) {
    target[key] = 'Wajib diisi.';
  } else if (!Number.isInteger(count) || count < 3 || count > 5) {
    target[key] = 'Harus 3–5 ekor.';
  }
}

export function validateGroupFields(group: GroupFormInput): Record<string, string> {
  const e: Record<string, string> = {};

  if (!(VISUAL_CHECK_VALUES as readonly string[]).includes(group.visualCheck)) {
    e.visualCheck = 'Wajib dipilih.';
  }

  validateSampleCount(e, 'sampleShrimpCount', group.sampleShrimpCount);

  return e;
}

/** Aturan kolom grup dengan prefiks grup (dipakai wizard). */
export function validateGroupForm(
  prefix: 'sr' | 'sd',
  group: GroupFormInput
): WizardErrors {
  const e: WizardErrors = {};
  for (const [field, message] of Object.entries(validateGroupFields(group))) {
    e[`${prefix}-${field}`] = message;
  }
  return e;
}

/**
 * Peringatan (bukan error): berat sampel sesudah lebih kecil dari sebelum.
 * Penyusutan air evaporasi itu sah, jadi angka ini hanya diminta dicatat —
 * tidak memblokir penyimpanan.
 */
export function groupWeightWarning(group: GroupFormInput): string | null {
  const before = parseFormNumber(group.labWeightBeforeG ?? '');
  const after = parseFormNumber(group.labWeightAfterG ?? '');
  if (before === null || after === null || Number.isNaN(before) || Number.isNaN(after)) {
    return null;
  }
  if (after < before) {
    return `Berat sesudah (${after} g) lebih kecil dari berat sebelum (${before} g) — catat alasan bila memang penyusutan.`;
  }
  return null;
}
