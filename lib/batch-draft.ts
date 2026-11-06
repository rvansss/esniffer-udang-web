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
  groupingCaptions?: string[];
  shrimpCount?: string;
  totalWeightG?: string;
  initialCondition?: string;
  visualCheck?: string;
  /** Pengukuran per ekor yang diketik di wizard (suhu dan panjang, sejajar). */
  shrimpTemperatures?: string[];
  shrimpLengths?: string[];
  /** Jumlah udang per sesi terpisah untuk suhu ruang (SR) dan dingin (SD). */
  sampleShrimpCountRoomTemp?: string;
  sampleShrimpCountCold?: string;
  coolerMarket?: string;
  coolerLab?: string;
  deviationAck?: boolean;
  /** Cap waktu simpan terakhir (epoch ms) — dasar masa berlaku draf. */
  savedAt?: number;
  /** Pemilik draf; draf milik akun lain diabaikan. */
  userId?: string;
  /** Caption foto tersimpan (berkas foto tidak ikut, lihat butir 13). */
  batchCaptions?: string[];
}

/**
 * Kunci penyimpanan draf. Dinaikkan ke v5 karena pengukuran per ekor
 * (`shrimpTemperatures`/`shrimpLengths`) dan jumlah udang per sesi yang
 * terpisah suhu ruang/dingin menggantikan field skalar v4; draf v4 tidak lagi
 * cocok dengan form ini, jadi sengaja diabaikan dan dibiarkan kedaluwarsa.
 */
export const BATCH_DRAFT_KEY = 'esniffer:batch-draft-v5';

/** Draf dianggap kedaluwarsa setelah 7 hari. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Nilai bawaan form — bukan tanda pengguna mengisi. */
const PRISTINE_DEFAULTS: Record<string, string> = {
  sourceType: 'market',
  shrimpCount: '10',
  initialCondition: 'dead',
  visualCheck: 'normal',
  sampleShrimpCountRoomTemp: '4',
  sampleShrimpCountCold: '4',
};

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Penjelajah mode privat/kuota penuh boleh melempar; draf lalu diabaikan.
    return null;
  }
};

/** Ada isian pada daftar pengukuran per ekor (indeks mana pun). */
const hasMeasurement = (values: string[] | undefined): boolean =>
  Array.isArray(values) && values.some((value) => typeof value === 'string' && value.trim() !== '');

/**
 * Draf dianggap bermakna bila ada isian di luar nilai bawaan. Waktu otomatis
 * dari jam device tidak dihitung — filled form tanpa sentuhan pengguna bukan
 * draf yang perlu dipulihkan. Baris pengukuran per ekor selalu isian pengguna.
 */
export const draftMeaningful = (d: BatchDraft): boolean =>
  hasMeasurement(d.shrimpTemperatures) ||
  hasMeasurement(d.shrimpLengths) ||
  (
    [
      'shrimpType',
      'marketSource',
      'sourceType',
      'shrimpCount',
      'totalWeightG',
      'initialCondition',
      'visualCheck',
      'sampleShrimpCountRoomTemp',
      'sampleShrimpCountCold',
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
    'totalWeightG',
    'initialCondition',
    'visualCheck',
    'coolerMarket',
    'coolerLab',
  ] as const;
  if (scalars.some((k) => typeof d[k] === 'string' && d[k]!.trim() !== '')) return true;
  if (d.deviationAck === true) return true;
  if (hasMeasurement(d.shrimpTemperatures) || hasMeasurement(d.shrimpLengths)) return true;
  const captionGroups = [d.batchCaptions, d.groupingCaptions];
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
