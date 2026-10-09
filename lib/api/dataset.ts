import { validationError } from './errors.ts';
import {
  isColdChainCompliant,
  isProcurementWindow,
  transportDurationMs,
  type StorageConditionCode,
} from '../../shared/dataset.ts';

/**
 * Serialisasi + parsing khusus API dataset (PRD §5.2).
 * Kontrak API memakai kode English lowercase persis CSV (market/farm,
 * room_temp/cold); konversi ke enum UPPER_CASE Prisma terpusat di sini
 * agar route tetap tipis.
 */

export type ApiSourceType = 'market' | 'farm';
export type ApiInitialCondition = 'fresh_dead' | 'dead' | 'alive';
export type ApiVisualCheck = 'normal' | 'melanosis' | 'damaged' | 'mixed_species';

const SOURCE_TO_DB = { market: 'MARKET', farm: 'FARM' } as const;
const DB_TO_SOURCE: Record<string, ApiSourceType> = { MARKET: 'market', FARM: 'farm' };

const CONDITION_TO_DB = { fresh_dead: 'FRESH_DEAD', dead: 'DEAD', alive: 'ALIVE' } as const;
const DB_TO_CONDITION: Record<string, ApiInitialCondition> = {
  FRESH_DEAD: 'fresh_dead',
  DEAD: 'dead',
  ALIVE: 'alive',
};

const VISUAL_TO_DB = {
  normal: 'NORMAL',
  melanosis: 'MELANOSIS',
  damaged: 'DAMAGED',
  mixed_species: 'MIXED_SPECIES',
} as const;
const DB_TO_VISUAL: Record<string, ApiVisualCheck> = {
  NORMAL: 'normal',
  MELANOSIS: 'melanosis',
  DAMAGED: 'damaged',
  MIXED_SPECIES: 'mixed_species',
};

const STORAGE_TO_DB = { room_temp: 'ROOM_TEMP', cold: 'COLD' } as const;
const DB_TO_STORAGE: Record<string, StorageConditionCode> = {
  ROOM_TEMP: 'room_temp',
  COLD: 'cold',
};

export function parseSourceType(val: unknown): 'MARKET' | 'FARM' {
  const normalized = val === undefined || val === null || val === '' ? 'market' : val;
  if (normalized === 'market' || normalized === 'farm') {
    return SOURCE_TO_DB[normalized];
  }
  throw validationError('Field "sourceType" harus "market" atau "farm"');
}

export function parseInitialCondition(val: unknown): 'FRESH_DEAD' | 'DEAD' | 'ALIVE' {
  if (val === 'fresh_dead' || val === 'dead' || val === 'alive') {
    return CONDITION_TO_DB[val];
  }
  throw validationError('Field "initialCondition" harus fresh_dead, dead, atau alive');
}

export function parseVisualCheck(val: unknown): 'NORMAL' | 'MELANOSIS' | 'DAMAGED' | 'MIXED_SPECIES' {
  if (val === 'normal' || val === 'melanosis' || val === 'damaged' || val === 'mixed_species') {
    return VISUAL_TO_DB[val];
  }
  throw validationError('Field "visualCheck" harus normal, melanosis, damaged, atau mixed_species');
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

export function parsePositiveNumber(val: unknown, fieldName: string, max: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > max) {
    throw validationError(`Field "${fieldName}" harus angka > 0 dan ≤ ${max}`);
  }
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
  return val;
}

export function parseIntMinimum(val: unknown, fieldName: string, min: number): number {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < min) {
    throw validationError(`Field "${fieldName}" harus bilangan bulat ≥ ${min}`);
  }
  return val;
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
  procuredAtUtc: Date;
  marketSource: string;
  sourceType: string;
  shrimpCount: number;
  sizeGrade: number;
  totalWeightG: { toNumber(): number };
  initialCondition: string;
  initialTempC: { toNumber(): number };
  departedAtUtc: Date;
  arrivedAtUtc: Date;
  coolerTempMinC: { toNumber(): number };
  coolerTempMaxC: { toNumber(): number };
  iceToShrimpRatio: string;
  tempStartC: { toNumber(): number };
  tempEndC: { toNumber(): number };
  rejectionNotes: string | null;
  photoUrls: string[];
  lockedAt: Date | null;
  createdAt: Date;
};

export function serializeBatch(b: DbBatch) {
  return {
    id: b.id,
    batchId: b.batchId,
    procuredAtUtc: b.procuredAtUtc.toISOString(),
    marketSource: b.marketSource,
    sourceType: DB_TO_SOURCE[b.sourceType] ?? b.sourceType,
    shrimpCount: b.shrimpCount,
    sizeGrade: b.sizeGrade,
    totalWeightG: dec(b.totalWeightG),
    initialCondition: DB_TO_CONDITION[b.initialCondition] ?? b.initialCondition,
    initialTempC: dec(b.initialTempC),
    departedAtUtc: b.departedAtUtc.toISOString(),
    arrivedAtUtc: b.arrivedAtUtc.toISOString(),
    coolerTempMinC: dec(b.coolerTempMinC),
    coolerTempMaxC: dec(b.coolerTempMaxC),
    iceToShrimpRatio: b.iceToShrimpRatio,
    tempStartC: dec(b.tempStartC),
    tempEndC: dec(b.tempEndC),
    rejectionNotes: b.rejectionNotes,
    photoUrls: b.photoUrls,
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
  targetTempC: { toNumber(): number };
  labTempC: { toNumber(): number };
  visualCheck: string;
  labWeightG: { toNumber(): number };
  sampleShrimpCount: number;
  sampleWeightG: { toNumber(): number };
  createdAt: Date;
};

export function serializeGroup(g: DbGroup) {
  return {
    id: g.id,
    groupId: g.groupId,
    batchId: g.batchId,
    chamberId: g.chamberId,
    storageCondition: DB_TO_STORAGE[g.storageCondition] ?? g.storageCondition,
    targetTempC: dec(g.targetTempC),
    labTempC: dec(g.labTempC),
    visualCheck: DB_TO_VISUAL[g.visualCheck] ?? g.visualCheck,
    labWeightG: dec(g.labWeightG),
    sampleShrimpCount: g.sampleShrimpCount,
    sampleWeightG: dec(g.sampleWeightG),
    createdAt: g.createdAt.toISOString(),
  };
}

/** Status sesi di kontrak API: selalu lowercase (DB menyimpan UPPER_CASE). UI wajib bandingkan lowercase. */
export type ApiSessionStatus = 'open' | 'complete' | 'incomplete' | 'locked';

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
  baselineMq137: { toNumber(): number } | null;
  baselineMq136: { toNumber(): number } | null;
  baselineMq4: { toNumber(): number } | null;
  warmupDone: boolean;
  cleaningDone: boolean;
  status: string;
  lockedAt: Date | null;
  createdAt: Date;
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
    baselineMq137: dec(s.baselineMq137),
    baselineMq136: dec(s.baselineMq136),
    baselineMq4: dec(s.baselineMq4),
    warmupDone: s.warmupDone,
    cleaningDone: s.cleaningDone,
    status: toApiSessionStatus(s.status),
    lockedAt: iso(s.lockedAt),
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * GATE B: urutan waktu perjalanan lab → pasar → lab. Belanja terjadi di
 * pasar, sehingga waktu beli wajib berada DI ANTARA berangkat dan tiba;
 * durasi berangkat → tiba >3 jam tetap butuh pengakuan deviasi eksplisit.
 */
export function assertTransportGates(
  procuredAtUtc: Date,
  departedAtUtc: Date,
  arrivedAtUtc: Date,
  deviationAcknowledged: unknown
): void {
  // `<= 0` (bukan `< 0`) karena cek DB menuntut urutan ketat, jadi waktu yang
  // sama persis pun harus ditolak di lapisan aplikasi.
  if (transportDurationMs(departedAtUtc, procuredAtUtc) <= 0) {
    throw validationError('Waktu berangkat (dari lab) harus sebelum waktu beli udang di pasar');
  }
  if (transportDurationMs(procuredAtUtc, arrivedAtUtc) <= 0) {
    throw validationError('Waktu tiba di lab harus setelah waktu beli udang');
  }
  if (!isColdChainCompliant(departedAtUtc, arrivedAtUtc) && deviationAcknowledged !== true) {
    throw validationError(
      'Durasi transportasi melebihi 3 jam; ulangi dengan deviationAcknowledged=true untuk mencatat sebagai deviasi'
    );
  }
}

/** GATE A: jendela pengadaan 06:00–08:00 WIB. */
export function assertProcurementWindow(procuredAtUtc: Date): void {
  if (!isProcurementWindow(procuredAtUtc)) {
    throw validationError('Belanja harus pagi 06:00–08:00 WIB sesuai protokol');
  }
}
