import { Prisma, type BatchDraft } from '@prisma/client';
import { validationError } from '../api/errors.ts';
import {
  DRAFT_MAX_PAYLOAD_BYTES,
  DRAFT_STEP_COUNT,
  draftLabelFrom,
  sanitizeDraftPayload,
  type DraftPayload,
} from '../../shared/batch-draft.ts';

/** Bentuk draf yang dikirim ke klien. */
export interface ApiDraft {
  id: string;
  label: string;
  step: number;
  payload: DraftPayload;
  status: string;
  version: number;
  ownerOperator: string;
  ownerDevice: string | null;
  consumedBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeDraft(row: BatchDraft): ApiDraft {
  return {
    id: row.id,
    label: row.label,
    step: row.step,
    payload: (row.payload ?? {}) as DraftPayload,
    status: row.status,
    version: row.version,
    ownerOperator: row.ownerOperator,
    ownerDevice: row.ownerDeviceLabel,
    consumedBatchId: row.consumedBatchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Langkah wizard yang sah: 0..2. */
export function parseDraftStep(value: unknown): number {
  const step = typeof value === 'string' ? Number(value) : value;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step >= DRAFT_STEP_COUNT) {
    throw validationError(`Field "step" harus bilangan bulat 0–${DRAFT_STEP_COUNT - 1}`);
  }
  return step;
}

/**
 * Payload draf: disaring ke field yang dikenal, lalu dibatasi ukurannya.
 * Batas ukuran penting karena isi form (pengukuran per ekor) bisa membesar
 * mengikuti jumlah udang; payload raksasa tidak boleh masuk kolom JSONB.
 */
export function parseDraftPayload(value: unknown): DraftPayload {
  if (value === undefined || value === null) {
    throw validationError('Field "payload" wajib diisi');
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('Field "payload" harus objek');
  }
  const payload = sanitizeDraftPayload(value);
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > DRAFT_MAX_PAYLOAD_BYTES) {
    throw validationError(
      `Draf terlalu besar (${size} byte, batas ${DRAFT_MAX_PAYLOAD_BYTES}). Kurangi isian sebelum menyimpan.`
    );
  }
  return payload;
}

/** Versi yang dikirim klien untuk optimistic concurrency. */
export function parseDraftVersion(value: unknown): number {
  const version = typeof value === 'string' ? Number(value) : value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw validationError('Field "version" wajib berupa bilangan bulat ≥ 1');
  }
  return version;
}

/** Label draf: nama lokasi beli, atau penanda "Draf baru". */
export function labelForDraft(payload: DraftPayload, fallback = 'Draf baru'): string {
  return draftLabelFrom(payload, fallback);
}

/** Nilai JSONB yang siap ditulis Prisma. */
export function draftPayloadJson(payload: DraftPayload): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}
