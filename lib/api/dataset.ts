import { isShrimpType } from '../../shared/shrimp.ts';
import { validationError } from './errors.ts';
import {
  parseIsoDate,
  parseRequiredString,
  parseOptionalString,
} from './validation.ts';
import {
  isColdChainCompliant,
  isProcurementWindow,
  transportDurationMs,
  MAX_PHOTO_CAPTION_LENGTH,
  DECIMAL_5_2_MAX_ABS,
  type StorageConditionCode,
} from '../../shared/dataset.ts';

/**
 * Serialisasi + parsing khusus API dataset (PRD §5.2).
 * Kontrak API memakai kode English lowercase persis CSV (market/farm,
 * room_temp/cold); konversi ke enum UPPER_CASE Prisma terpusat di sini
 * agar route tetap tipis.
 */

export type ApiSourceType = 'market' | 'farm' | 'supermarket';
export type ApiInitialCondition = 'dead' | 'alive';
export type ApiVisualCheck = 'normal' | 'melanosis' | 'damaged' | 'mixed_species';

// Revisi putaran 2 butir 6: supermarket menjadi nilai enum source_type.
const SOURCE_TO_DB = { market: 'MARKET', farm: 'FARM', supermarket: 'SUPERMARKET' } as const;
export const DB_TO_SOURCE: Record<string, ApiSourceType> = {
  MARKET: 'market',
  FARM: 'farm',
  SUPERMARKET: 'supermarket',
};

const CONDITION_TO_DB = { dead: 'DEAD', alive: 'ALIVE' } as const;
// Peta DB → API diekspor agar konsumen lain (mis. ekspor CSV) tidak menyalin
// peta lowercase sendiri dan istilah tetap satu sumber kebenaran.
export const DB_TO_CONDITION: Record<string, ApiInitialCondition> = {
  DEAD: 'dead',
  ALIVE: 'alive',
};

const VISUAL_TO_DB = {
  normal: 'NORMAL',
  melanosis: 'MELANOSIS',
  damaged: 'DAMAGED',
  mixed_species: 'MIXED_SPECIES',
} as const;
export const DB_TO_VISUAL: Record<string, ApiVisualCheck> = {
  NORMAL: 'normal',
  MELANOSIS: 'melanosis',
  DAMAGED: 'damaged',
  MIXED_SPECIES: 'mixed_species',
};

const STORAGE_TO_DB = { room_temp: 'ROOM_TEMP', cold: 'COLD' } as const;
export const DB_TO_STORAGE: Record<string, StorageConditionCode> = {
  ROOM_TEMP: 'room_temp',
  COLD: 'cold',
};

export function parseSourceType(val: unknown): 'MARKET' | 'FARM' | 'SUPERMARKET' {
  const normalized = val === undefined || val === null || val === '' ? 'market' : val;
  if (normalized === 'market' || normalized === 'farm' || normalized === 'supermarket') {
    return SOURCE_TO_DB[normalized];
  }
  throw validationError('Field "sourceType" harus "market", "farm", atau "supermarket"');
}

export function parseInitialCondition(val: unknown): 'DEAD' | 'ALIVE' {
  if (val === 'dead' || val === 'alive') {
    return CONDITION_TO_DB[val];
  }
  throw validationError('Field "initialCondition" harus dead atau alive');
}

export function parseVisualCheck(val: unknown): 'NORMAL' | 'MELANOSIS' | 'DAMAGED' | 'MIXED_SPECIES' {
  if (val === 'normal' || val === 'melanosis' || val === 'damaged' || val === 'mixed_species') {
    return VISUAL_TO_DB[val];
  }
  throw validationError('Field "visualCheck" harus normal, melanosis, damaged, atau mixed_species');
}

/**
 * Mode penyimpanan grup dingin (revisi putaran 2 butir 1). Kontrak API
 * memakai lowercase chamber/plain_fridge, mengikuti pola storageCondition.
 */
export type ApiColdStorageMode = 'chamber' | 'plain_fridge';

const COLD_MODE_TO_DB = { chamber: 'CHAMBER', plain_fridge: 'PLAIN_FRIDGE' } as const;
const DB_TO_COLD_MODE: Record<string, ApiColdStorageMode> = {
  CHAMBER: 'chamber',
  PLAIN_FRIDGE: 'plain_fridge',
};

export function parseColdStorageMode(val: unknown): 'CHAMBER' | 'PLAIN_FRIDGE' {
  if (val === 'chamber' || val === 'plain_fridge') {
    return COLD_MODE_TO_DB[val];
  }
  throw validationError('Field "coldStorageMode" harus chamber atau plain_fridge');
}

export function parseStorageCondition(val: unknown): {
  api: StorageConditionCode;
  db: 'ROOM_TEMP' | 'COLD';
} {
  if (val === 'room_temp' || val === 'cold') {
    return { api: val, db: STORAGE_TO_DB[val] };
  }
  throw validationError('Field "storageCondition" harus room_temp atau cold');
}

function assertMeasurementPrecision(value: number, fieldName: string): void {
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw validationError(`Field "${fieldName}" maksimal 2 angka desimal`);
}

export function parsePositiveNumber(val: unknown, fieldName: string, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > max) {
    throw validationError(`Field "${fieldName}" harus angka > 0 dan ≤ ${max}`);
  }
  assertMeasurementPrecision(val, fieldName);
  return val;
}

export function parseFiniteNumber(val: unknown, fieldName: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw validationError(`Field "${fieldName}" harus angka`);
  }
  return val;
}

export function parseBoundedNumber(val: unknown, fieldName: string, min: number, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
    throw validationError(`Field "${fieldName}" harus ${min} sampai ${max}`);
  }
  assertMeasurementPrecision(val, fieldName);
  return val;
}

/**
 * Angka pengukuran yang bebas rentang domain: suhu cool box, suhu udang, dan
 * panjang udang menerima nilai apa pun (termasuk desimal). Satu-satunya batas
 * adalah kapasitas kolom `DECIMAL(5,2)` — kalau tidak diperiksa di sini,
 * PostgreSQL melempar numeric-overflow dan klien menerima 500, bukan 422.
 * Presisi tetap maksimal 2 desimal agar cocok dengan skala kolom.
 */
export function parseDecimalNumber(val: unknown, fieldName: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw validationError(`Field "${fieldName}" harus angka`);
  }
  if (Math.abs(val) > DECIMAL_5_2_MAX_ABS) {
    throw validationError(
      `Field "${fieldName}" di luar kapasitas kolom (−${DECIMAL_5_2_MAX_ABS} sampai ${DECIMAL_5_2_MAX_ABS})`
    );
  }
  assertMeasurementPrecision(val, fieldName);
  return val;
}

export function parseIntMinimum(val: unknown, fieldName: string, min: number): number {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < min || val > 2147483647) {
    throw validationError(`Field "${fieldName}" harus bilangan bulat ≥ ${min}`);
  }
  return val;
}

/** Caption foto: wajib terisi (maks 140 karakter) agar tiap foto bisa dibedakan. */
export function parsePhotoCaption(val: unknown, index: number): string {
  const caption = typeof val === 'string' ? val.trim() : '';
  if (caption === '') {
    throw validationError(`Caption foto ke-${index + 1} wajib diisi (maks ${MAX_PHOTO_CAPTION_LENGTH} karakter)`);
  }
  if (caption.length > MAX_PHOTO_CAPTION_LENGTH) {
    throw validationError(`Caption foto ke-${index + 1} maksimal ${MAX_PHOTO_CAPTION_LENGTH} karakter`);
  }
  return caption;
}

/** Decimal Prisma → number JSON; null lolos apa adanya. */
export function dec(val: { toNumber(): number } | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  return val.toNumber();
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

type DbBatch = {
  id: string;
  batchId: string;
  departedAtUtc: Date | null;
  procuredAtUtc: Date;
  marketSource: string;
  sourceType: string;
  shrimpType: string | null;
  shrimpCount: number;
  sizeGrade: number;
  shrimpLengthCm: { toNumber(): number } | null;
  totalWeightG: { toNumber(): number };
  initialCondition: string;
  initialTempC: { toNumber(): number };
  arrivedAtUtc: Date;
  coolerTempDepartureC: { toNumber(): number } | null;
  coolerTempMarketC: { toNumber(): number };
  coolerTempLabC: { toNumber(): number };
  iceToShrimpRatio: string;
  rejectionNotes: string | null;
  lockedAt: Date | null;
  createdAt: Date;
  /** Label operator perangkat pencatat (akun dipakai bersama). */
  operatorLabel?: string | null;
};

export function serializeBatch(b: DbBatch) {
  return {
    id: b.id,
    batchId: b.batchId,
    departedAtUtc: iso(b.departedAtUtc),
    procuredAtUtc: b.procuredAtUtc.toISOString(),
    marketSource: b.marketSource,
    shrimpType: b.shrimpType?.toLowerCase() ?? null,
    sourceType: DB_TO_SOURCE[b.sourceType] ?? b.sourceType,
    shrimpCount: b.shrimpCount,
    sizeGrade: b.sizeGrade,
    shrimpLengthCm: dec(b.shrimpLengthCm),
    totalWeightG: dec(b.totalWeightG),
    initialCondition: DB_TO_CONDITION[b.initialCondition] ?? b.initialCondition,
    initialTempC: dec(b.initialTempC),
    arrivedAtUtc: b.arrivedAtUtc.toISOString(),
    coolerTempDepartureC: dec(b.coolerTempDepartureC),
    coolerTempMarketC: dec(b.coolerTempMarketC),
    coolerTempLabC: dec(b.coolerTempLabC),
    // Alias deprecated (butir 7): konsumen JSON lama masih membaca nama
    // min/max. Nilai sama persis dengan market/lab; hapus setelah kontrak
    // lama benar-benar tidak dipakai.
    coolerTempMinC: dec(b.coolerTempMarketC),
    coolerTempMaxC: dec(b.coolerTempLabC),
    iceToShrimpRatio: b.iceToShrimpRatio,
    rejectionNotes: b.rejectionNotes,
    // Nama operator yang mencatat; null pada baris lama sebelum Fase 0.
    operatorLabel: b.operatorLabel ?? null,
    lockedAt: iso(b.lockedAt),
    createdAt: b.createdAt.toISOString(),
  };
}

type DbGroup = {
  id: string;
  groupId: string;
  batchId: string;
  chamberId: string | null;
  storageCondition: string;
  coldStorageMode: string;
  targetTempC: { toNumber(): number };
  labTempC: { toNumber(): number } | null;
  visualCheck: string;
  labWeightBeforeG: { toNumber(): number } | null;
  labWeightAfterG: { toNumber(): number } | null;
  sampleShrimpCount: number;
  createdAt: Date;
};

export function serializeGroup(g: DbGroup) {
  return {
    id: g.id,
    groupId: g.groupId,
    batchId: g.batchId,
    chamberId: g.chamberId,
    storageCondition: DB_TO_STORAGE[g.storageCondition] ?? g.storageCondition,
    coldStorageMode: DB_TO_COLD_MODE[g.coldStorageMode] ?? g.coldStorageMode,
    targetTempC: dec(g.targetTempC),
    labTempC: dec(g.labTempC),
    visualCheck: DB_TO_VISUAL[g.visualCheck] ?? g.visualCheck,
    labWeightBeforeG: dec(g.labWeightBeforeG),
    labWeightAfterG: dec(g.labWeightAfterG),
    sampleShrimpCount: g.sampleShrimpCount,
    createdAt: g.createdAt.toISOString(),
  };
}

/** Status sesi di kontrak API: selalu lowercase (DB menyimpan UPPER_CASE). UI wajib bandingkan lowercase. */
export type ApiSessionStatus = 'open' | 'complete' | 'incomplete' | 'locked';

type DbNotification = {
  id: string;
  batchId: string | null;
  sessionId: string | null;
  kind: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Notifikasi milik user login (revisi putaran 2 butir 9). userId tidak ikut
 * — pemilik implisit dari sesi auth — dan isi dibuat oleh worker, bukan API.
 */
export function serializeNotification(n: DbNotification) {
  return {
    id: n.id,
    batchId: n.batchId,
    sessionId: n.sessionId,
    kind: n.kind,
    message: n.message,
    readAt: iso(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

export function toApiSessionStatus(db: string): ApiSessionStatus {
  const lowered = db.toLowerCase();
  if (lowered === 'open' || lowered === 'complete' || lowered === 'incomplete' || lowered === 'locked') {
    return lowered;
  }
  throw validationError(`Status sesi tidak dikenal: ${db}`);
}

type DbSession = {
  id: string;
  sessionId: string;
  groupId: string;
  batchId: string;
  chamberId: string | null;
  deviceId: string | null;
  timepointCode: string;
  elapsedHours: number;
  startedAtUtc: Date;
  endedAtUtc: Date | null;
  durationSeconds: number | null;
  baselineMq137: { toNumber(): number } | null;
  baselineMq136: { toNumber(): number } | null;
  baselineMq4: { toNumber(): number } | null;
  warmupDone: boolean;
  cleaningDone: boolean;
  shrimpTempC: { toNumber(): number } | null;
  shrimpWeightG: { toNumber(): number } | null;
  status: string;
  lockedAt: Date | null;
  createdAt: Date;
  /** Jejak kalibrasi & operator (Fase 0); null pada baris sebelum migrasi. */
  calibrationCompletedAtUtc?: Date | null;
  calibrationVersion?: number | null;
  createdByOperator?: string | null;
  createdByDevice?: string | null;
  completedByOperator?: string | null;
  completedByDevice?: string | null;
};

export function serializeSession(s: DbSession) {
  return {
    id: s.id,
    sessionId: s.sessionId,
    groupId: s.groupId,
    batchId: s.batchId,
    chamberId: s.chamberId,
    deviceId: s.deviceId,
    timepointCode: s.timepointCode,
    elapsedHours: s.elapsedHours,
    startedAtUtc: s.startedAtUtc.toISOString(),
    endedAtUtc: iso(s.endedAtUtc),
    durationSeconds: s.durationSeconds ?? null,
    // Data observasi per tahap (migrasi 20261022170000): baris lama = null.
    shrimpTempC: dec(s.shrimpTempC),
    shrimpWeightG: dec(s.shrimpWeightG),
    baselineMq137: dec(s.baselineMq137),
    baselineMq136: dec(s.baselineMq136),
    baselineMq4: dec(s.baselineMq4),
    warmupDone: s.warmupDone,
    cleaningDone: s.cleaningDone,
    // Bukti prasyarat kalibrasi + siapa yang mencatat/menyelesaikan tahap.
    calibrationCompletedAtUtc: iso(s.calibrationCompletedAtUtc ?? null),
    calibrationVersion: s.calibrationVersion ?? null,
    createdByOperator: s.createdByOperator ?? null,
    createdByDevice: s.createdByDevice ?? null,
    completedByOperator: s.completedByOperator ?? null,
    completedByDevice: s.completedByDevice ?? null,
    status: toApiSessionStatus(s.status),
    lockedAt: iso(s.lockedAt),
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * GATE B: urutan waktu berangkat → beli → tiba di lab. Ketiga titik waktu
 * dicatat; durasi tiba dikurangi beli >3 jam tetap butuh pengakuan deviasi
 * eksplisit (jangkar cold-chain tidak berubah).
 */
export function assertTransportGates(
  departedAtUtc: Date,
  procuredAtUtc: Date,
  arrivedAtUtc: Date,
  deviationAcknowledged: unknown
): void {
  // `<= 0` (bukan `< 0`) karena cek DB menuntut urutan ketat, jadi waktu yang
  // sama persis pun harus ditolak di lapisan aplikasi.
  if (transportDurationMs(departedAtUtc, procuredAtUtc) <= 0) {
    throw validationError('Tanggal dan jam berangkat harus sebelum tanggal dan jam beli');
  }
  if (transportDurationMs(procuredAtUtc, arrivedAtUtc) <= 0) {
    throw validationError('Tanggal dan jam tiba harus setelah tanggal dan jam beli');
  }
  if (!isColdChainCompliant(procuredAtUtc, arrivedAtUtc) && deviationAcknowledged !== true) {
    throw validationError(
      'Durasi transportasi melebihi 3 jam; ulangi dengan deviationAcknowledged=true untuk mencatat sebagai deviasi'
    );
  }
}

/** GATE A: jendela pengadaan 05:00–08:00 WIB untuk berangkat, beli, dan tiba. */
export function assertProcurementWindow(label: string, atUtc: Date): void {
  if (!isProcurementWindow(atUtc)) {
    throw validationError(
      `Field "${label}" harus di antara 05:00–08:00 WIB sesuai protokol`
    );
  }
}

/**
 * Parsing & validasi lengkap payload data batch (data pencatatan langkah 1–2
 * wizard). POST create dan PATCH update di route /batches memakai fungsi ini
 * atas dasar satu sumber kebenaran, jadi aturan gerbang tidak bisa berbeda
 * antara "buat baru" dan "koreksi data".
 *
 * `body` boleh berisi field di luar daftar ini (id, sizeGrade, aliash lama
 * coolerTempMinC/MaxC, dsb.) — dibaca hanya field yang relevan; sizeGrade
 * selalu dihitung ulang dari jumlah ÷ berat agar kontra uyar selalu serasi.
 */
export function parseBatchFields(body: Record<string, unknown> | undefined, requireShrimpType = true): {
  departedAtUtc: Date;
  procuredAtUtc: Date;
  arrivedAtUtc: Date;
  marketSource: string;
  sourceType: 'MARKET' | 'FARM' | 'SUPERMARKET';
  shrimpType: 'VANAME' | 'WINDU' | null;
  shrimpCount: number;
  sizeGrade: number;
  shrimpLengthCm: number;
  totalWeightG: number;
  initialCondition: 'DEAD' | 'ALIVE';
  initialTempC: number;
  coolerTempDepartureC: number;
  coolerTempMarketC: number;
  coolerTempLabC: number;
  iceToShrimpRatio: string;
  rejectionNotes: string | null;
} {
  const b = body ?? {};
  // Helper menerima body JSON apa pun; field tanggal dibaca sebagai string.
  const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const departedAtUtc = parseIsoDate(asStr(b?.departedAtUtc), 'departedAtUtc', true)!;
  const procuredAtUtc = parseIsoDate(asStr(b?.procuredAtUtc), 'procuredAtUtc', true)!;
  const marketSource = parseRequiredString(b?.marketSource, 'marketSource', 1, 100);
  const sourceType = parseSourceType(b?.sourceType);
  const shrimpType = b.shrimpType == null && !requireShrimpType ? null : parseShrimpType(b.shrimpType);
  // Jumlah udang tidak lagi dibatasi 10–100: bilangan bulat ≥ 1, batas atas
  // hanya lebar kolom INTEGER.
  const shrimpCount = parseIntMinimum(b?.shrimpCount, 'shrimpCount', 1);
  // Ukuran ekor/kg terhitung otomatis (tidak dibaca dari input):
  // jumlah ekor ÷ berat total (gram) × 1000, dibulatkan ke bilangan bulat.
  const totalWeightG = parsePositiveNumber(b?.totalWeightG, 'totalWeightG', 2000);
  const derivedSizeGrade = Math.round((shrimpCount / totalWeightG) * 1000);
  if (derivedSizeGrade > 2147483647) {
    // Jumlah ekor boleh besar, tetapi kolom size_grade tetap INTEGER: tolak
    // dengan pesan yang menyebut penyebabnya, bukan galat sizeGrade yang ambigu.
    throw validationError('Field "shrimpCount" terlalu besar dibanding "totalWeightG" (sizeGrade melebihi batas penyimpanan)');
  }
  const sizeGrade = parseIntMinimum(derivedSizeGrade, 'sizeGrade', 1);
  // Panjang & suhu udang bebas rentang (desimal diterima); yang dijaga hanya
  // kapasitas kolom DECIMAL(5,2) dan presisi 2 desimal.
  const shrimpLengthCm = parseDecimalNumber(b?.shrimpLengthCm, 'shrimpLengthCm');
  const initialCondition = parseInitialCondition(b?.initialCondition);
  const initialTempC = parseDecimalNumber(b?.initialTempC, 'initialTempC');
  const arrivedAtUtc = parseIsoDate(asStr(b?.arrivedAtUtc), 'arrivedAtUtc', true)!;
  // Tiga titik pengukuran cool box (berangkat, pasar, lab) bebas rentang:
  // penyimpangan dari acuan 0–4 °C hanya peringatan di UI, data tetap disimpan.
  // Nama lama (min/max) tetap diterima sebagai alias deprecated.
  const coolerTempDepartureC = parseDecimalNumber(b?.coolerTempDepartureC, 'coolerTempDepartureC');
  const coolerTempMarketC = parseDecimalNumber(
    b?.coolerTempMarketC ?? b?.coolerTempMinC,
    'coolerTempMarketC'
  );
  const coolerTempLabC = parseDecimalNumber(
    b?.coolerTempLabC ?? b?.coolerTempMaxC,
    'coolerTempLabC'
  );
  const iceToShrimpRatio = b?.iceToShrimpRatio === undefined || b?.iceToShrimpRatio === ''
    ? '2:1'
    : parseRequiredString(b?.iceToShrimpRatio, 'iceToShrimpRatio', 3, 8);
  if (!/^\d+:\d+$/.test(iceToShrimpRatio)) {
    throw validationError('Field "iceToShrimpRatio" harus berpola N:N, contoh 2:1');
  }
  const rejectionNotes = parseOptionalString(b?.rejectionNotes, 'rejectionNotes', 500);

  assertProcurementWindow('departedAtUtc', departedAtUtc);
  assertProcurementWindow('procuredAtUtc', procuredAtUtc);
  assertProcurementWindow('arrivedAtUtc', arrivedAtUtc);
  assertTransportGates(departedAtUtc, procuredAtUtc, arrivedAtUtc, b?.deviationAcknowledged);

  return {
    departedAtUtc,
    procuredAtUtc,
    arrivedAtUtc,
    marketSource,
    sourceType,
    shrimpType,
    shrimpCount,
    sizeGrade,
    shrimpLengthCm,
    totalWeightG,
    initialCondition,
    initialTempC,
    coolerTempDepartureC,
    coolerTempMarketC,
    coolerTempLabC,
    iceToShrimpRatio,
    rejectionNotes,
  };
}

export function parseShrimpType(value: unknown): 'VANAME' | 'WINDU' {
  if (!isShrimpType(value)) throw validationError('Field "shrimpType" wajib vaname atau windu');
  return value === 'vaname' ? 'VANAME' : 'WINDU';
}
