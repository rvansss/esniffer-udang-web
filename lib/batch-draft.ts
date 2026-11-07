/**
 * Klien draf wizard batch baru (Fase 0: server, bukan localStorage).
 *
 * Sebelumnya draf disimpan di satu kunci localStorage, sehingga isian yang
 * dimulai di ponsel tidak bisa dilanjutkan di laptop dan dua operator di satu
 * browser saling menimpa. Sekarang draf adalah baris `batch_drafts` dengan
 * nomor versi: setiap penyimpanan membawa versi yang terakhir dibaca, dan
 * server menolak (409) bila draf sudah berubah di perangkat lain.
 *
 * Foto tetap tidak ikut: `File` tidak bisa diserialisasi. Yang disimpan adalah
 * caption-nya, jadi setelah melanjutkan draf di perangkat lain operator perlu
 * memilih ulang berkas fotonya.
 */

import type { DraftPayload } from '../shared/batch-draft.ts';

/** Draf seperti yang dikirim API. */
export interface DraftRecord {
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

/** Draf sudah diubah perangkat lain sejak versi yang dibaca klien. */
export class DraftConflictError extends Error {
  readonly serverVersion?: number;
  readonly ownerOperator?: string;
  readonly ownerDevice?: string;
  readonly updatedAt?: string;

  constructor(
    message: string,
    serverVersion?: number,
    ownerOperator?: string,
    ownerDevice?: string,
    updatedAt?: string
  ) {
    super(message);
    this.name = 'DraftConflictError';
    this.serverVersion = serverVersion;
    this.ownerOperator = ownerOperator;
    this.ownerDevice = ownerDevice;
    this.updatedAt = updatedAt;
  }
}

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => undefined);
  return (
    (body as { error?: { message?: string } } | undefined)?.error?.message ??
    `${fallback} (kode ${res.status}).`
  );
}

/** Draf terbuka milik akun ini, terbaru lebih dulu. */
export async function listDrafts(apiFetch: ApiFetch): Promise<DraftRecord[]> {
  const res = await apiFetch('/api/v1/batch-drafts');
  if (!res.ok) throw new Error(await readError(res, 'Gagal memuat daftar draf'));
  const body = (await res.json()) as { data?: DraftRecord[] };
  return Array.isArray(body.data) ? body.data : [];
}

/** Membuat draf baru (dipanggil saat isian pertama kali berubah). */
export async function createDraft(
  apiFetch: ApiFetch,
  payload: DraftPayload,
  step: number
): Promise<DraftRecord> {
  const res = await apiFetch('/api/v1/batch-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, step }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Gagal menyimpan draf'));
  return ((await res.json()) as { data: DraftRecord }).data;
}

/**
 * Menyimpan perubahan draf. Melempar `DraftConflictError` bila versi sudah
 * berubah — pemanggil yang memutuskan: muat ulang draf server atau buang
 * perubahan lokal, jangan menimpa diam-diam.
 */
export async function updateDraft(
  apiFetch: ApiFetch,
  id: string,
  input: { payload: DraftPayload; step: number; version: number }
): Promise<DraftRecord> {
  const res = await apiFetch(`/api/v1/batch-drafts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string; details?: unknown[] } }
      | undefined;
    const detail = (body?.error?.details?.[0] ?? {}) as {
      version?: number;
      ownerOperator?: string;
      ownerDevice?: string;
      updatedAt?: string;
    };
    throw new DraftConflictError(
      body?.error?.message ?? 'Draf sudah diperbarui di perangkat lain.',
      detail.version,
      detail.ownerOperator,
      detail.ownerDevice ?? undefined,
      detail.updatedAt
    );
  }
  if (!res.ok) throw new Error(await readError(res, 'Gagal menyimpan draf'));
  return ((await res.json()) as { data: DraftRecord }).data;
}

/** Membuang draf (status DISCARDED, bukan dihapus). */
export async function discardDraft(apiFetch: ApiFetch, id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/batch-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, 'Gagal membuang draf'));
}

/**
 * Menandai draf sudah menjadi batch `batchId` (idempoten). Bila ini gagal,
 * batch tetap sudah tersimpan — jadi kegagalan di sini tidak boleh membuat
 * operator mengira batch-nya hilang.
 */
export async function consumeDraft(apiFetch: ApiFetch, id: string, batchId: string): Promise<void> {
  const res = await apiFetch(`/api/v1/batch-drafts/${encodeURIComponent(id)}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Gagal menandai draf terpakai'));
}

/** Ringkasan waktu relatif untuk daftar draf ("12 menit lalu"). */
export function draftAgeText(iso: string, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}
