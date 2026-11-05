/**
 * Draf wizard batch baru (revisi putaran 2 butir 13): isian form disimpan di
 * localStorage browser, bukan di server. Foto tidak ikut — File tidak bisa
 * diserialisasi ke JSON dan tetap harus dipilih ulang secara manual.
 *
 * Tiga aturan agar draf tidak menyesatkan:
 * - kunci versi: perubahan skema menaikkan versi kunci sehingga draf lama
 *   dibuang, bukan dibaca bentrok;
 * - masa berlaku: draf yang terlalu lama dibuang saat dimuat;
 * - cakupan pengguna: draf milik akun lain diabaikan (perangkat bersama).
 */

export interface BatchDraft {
  step?: number;
  departedAt?: string;
  coolerDeparture?: string;
  procuredAt?: string;
  arrivedAt?: string;
  marketSource?: string;
  sourceType?: string;
  shrimpType?: string;
  grouping?: unknown;
  groupingCaptions?: string[];
  shrimpCount?: string;
  shrimpLengthCm?: string;
  totalWeightG?: string;
  initialCondition?: string;
  initialTempC?: string;
  coolerMarket?: string;
  coolerLab?: string;
  deviationAck?: boolean;
  groupSr?: unknown;
  groupSd?: unknown;
  /** Cap waktu simpan terakhir (epoch ms) — dasar masa berlaku draf. */
  savedAt?: number;
  /** Pemilik draf; draf milik akun lain diabaikan. */
  userId?: string;
  /** Caption foto tersimpan (berkas foto tidak ikut, lihat butir 13). */
  batchCaptions?: string[];
  groupCaptionsSr?: string[];
  groupCaptionsSd?: string[];
}

/**
 * Kunci penyimpanan draf. Dinaikkan ke v4 untuk jenis udang dan pengelompokan bersama;
 * draf v3 tidak lagi cocok dengan form ini,
 * jadi sengaja diabaikan dan dibiarkan kedaluwarsa sendiri.
 */
export const BATCH_DRAFT_KEY = 'esniffer:batch-draft-v4';

/** Draf dianggap kedaluwarsa setelah 7 hari. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Nilai bawaan form — bukan tanda pengguna mengisi. */
const PRISTINE_DEFAULTS: Record<string, string> = {
  sourceType: 'market',
  shrimpCount: '12',
  initialCondition: 'dead',
};

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Penjelajah mode privat/kuota penuh boleh melempar; draf lalu diabaikan.
    return null;
  }
};

/**
 * Draf dianggap bermakna bila ada isian di luar nilai bawaan. Waktu otomatis
 * dari jam device tidak dihitung — filled form tanpa sentuhan pengguna bukan
 * draf yang perlu dipulihkan.
 */
export const draftMeaningful = (d: BatchDraft): boolean =>
  (
    [
      'shrimpType',
      'marketSource',
      'sourceType',
      'shrimpCount',
      'shrimpLengthCm',
      'totalWeightG',
      'initialCondition',
      'initialTempC',
      'coolerDeparture',
      'coolerMarket',
      'coolerLab',
    ] as const
  ).some((k) => {
    const v = d[k];
    if (typeof v !== 'string' || v.trim() === '') return false;
    return PRISTINE_DEFAULTS[k] !== v;
  });

/** True bila draf masih memuat isi apa pun. */
const hasAnyContent = (d: BatchDraft): boolean => {
  const scalars = [
    'departedAt',
    'coolerDeparture',
    'procuredAt',
    'arrivedAt',
    'shrimpType',
    'marketSource',
    'sourceType',
    'shrimpCount',
    'shrimpLengthCm',
    'totalWeightG',
    'initialCondition',
    'initialTempC',
    'coolerMarket',
    'coolerLab',
  ] as const;
  if (scalars.some((k) => typeof d[k] === 'string' && d[k]!.trim() !== '')) return true;
  if (d.deviationAck === true) return true;
  const captionGroups = [d.batchCaptions, d.groupingCaptions, d.groupCaptionsSr, d.groupCaptionsSd];
  return captionGroups.some(
    (c) => Array.isArray(c) && c.some((x) => typeof x === 'string' && x.trim() !== '')
  );
};

/**
 * Simpan draf. Cap waktu disimpan di sini supaya tidak ada pemanggil yang
 * lupa menandainya — tanpa cap waktu draf tidak bisa dinilai umurnya.
 */
export function saveBatchDraft(draft: BatchDraft): void {
  if (!hasAnyContent(draft)) {
    // Semua dikosongkan user? Bersihkan draf agar tidak bangkit dari kuburan.
    removeBatchDraft();
    return;
  }
  try {
    storage()?.setItem(BATCH_DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Tanpa localStorage: wizard tetap jalan, hanya tanpa draf.
  }
}

/**
 * Muat draf yang masih berlaku. Draf kedaluwarsa (atau dari skema lama tanpa
 * cap waktu) dibuang; draf milik pengguna lain diabaikan tanpa dihapus.
 */
export function loadBatchDraft(userId?: string): BatchDraft | null {
  try {
    const raw = storage()?.getItem(BATCH_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const draft = parsed as BatchDraft;
    if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) {
      // Skema lama tanpa cap waktu — umurnya tidak bisa dinilai, jadi dibuang.
      storage()?.removeItem(BATCH_DRAFT_KEY);
      return null;
    }
    if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      storage()?.removeItem(BATCH_DRAFT_KEY);
      return null;
    }
    if (userId && draft.userId && draft.userId !== userId) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function removeBatchDraft(): void {
  try {
    storage()?.removeItem(BATCH_DRAFT_KEY);
  } catch {
    // Abaikan.
  }
}
