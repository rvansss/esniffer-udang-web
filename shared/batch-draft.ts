/**
 * Kontrak draf wizard batch baru — dipakai server (validasi) dan klien (isi
 * form). Satu definisi field mencegah server menerima kunci yang tidak dikenal
 * form, dan mencegah form mengirim field yang tidak pernah disimpan.
 *
 * Sejak Fase 0 draf hidup di server (`batch_drafts`), bukan localStorage: isian
 * yang dimulai di ponsel bisa dilanjutkan di laptop, dan dua operator tidak
 * saling menimpa karena setiap perubahan membawa nomor versi.
 */

/** Batas umur draf. Draf yang lebih tua dari ini tidak ditampilkan lagi. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Batas ukuran payload setelah diserialisasi (pengaman, bukan target). */
export const DRAFT_MAX_PAYLOAD_BYTES = 64 * 1024;
/** Jumlah langkah wizard: Pengadaan, Kondisi Udang, Pengelompokan. */
export const DRAFT_STEP_COUNT = 3;
/** Batas jumlah draf terbuka per akun — mencegah penumpukan tanpa disadari. */
export const DRAFT_MAX_OPEN_PER_OWNER = 20;

/** Field teks tunggal yang boleh ada di draf (nilai form apa adanya). */
export const DRAFT_STRING_KEYS = [
  'departedAt',
  'coolerDeparture',
  'procuredAt',
  'arrivedAt',
  'marketSource',
  'sourceType',
  'shrimpType',
  'shrimpCount',
  'totalWeightG',
  'initialCondition',
  'visualCheck',
  'coolerMarket',
  'coolerLab',
  'sampleShrimpCountRoomTemp',
  'sampleShrimpCountCold',
] as const;

/** Field daftar teks: pengukuran per ekor dan caption foto. */
export const DRAFT_ARRAY_KEYS = [
  'shrimpTemperatures',
  'shrimpLengths',
  'batchCaptions',
  'groupingCaptions',
] as const;

/** Field boolean: pengakuan deviasi durasi transport. */
export const DRAFT_BOOL_KEYS = ['deviationAck'] as const;

const STRING_MAX_LENGTH = 500;
const ARRAY_MAX_ITEMS = 1000;
const ARRAY_ITEM_MAX_LENGTH = 200;

/** Nilai yang sudah lolos sanitasi. */
export type DraftPayload = {
  [K in (typeof DRAFT_STRING_KEYS)[number]]?: string;
} & {
  [K in (typeof DRAFT_ARRAY_KEYS)[number]]?: string[];
} & {
  [K in (typeof DRAFT_BOOL_KEYS)[number]]?: boolean;
};

/**
 * Menyaring payload klien: hanya kunci yang dikenal form, hanya tipe yang
 * benar, panjang dibatasi. Kunci asing dibuang diam-diam (bukan 422) supaya
 * form versi lama tetap bisa menyimpan draf setelah server diperbarui.
 */
export function sanitizeDraftPayload(value: unknown): DraftPayload {
  const out: Record<string, unknown> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out as DraftPayload;
  const input = value as Record<string, unknown>;

  for (const key of DRAFT_STRING_KEYS) {
    const raw = input[key];
    if (typeof raw === 'string') out[key] = raw.slice(0, STRING_MAX_LENGTH);
  }
  for (const key of DRAFT_ARRAY_KEYS) {
    const raw = input[key];
    if (!Array.isArray(raw)) continue;
    out[key] = raw
      .filter((item): item is string => typeof item === 'string')
      .slice(0, ARRAY_MAX_ITEMS)
      .map((item) => item.slice(0, ARRAY_ITEM_MAX_LENGTH));
  }
  for (const key of DRAFT_BOOL_KEYS) {
    const raw = input[key];
    if (typeof raw === 'boolean') out[key] = raw;
  }
  return out as DraftPayload;
}

/** True bila payload tidak memuat isian apa pun yang berarti. */
export function isDraftPayloadEmpty(payload: DraftPayload): boolean {
  const hasString = DRAFT_STRING_KEYS.some((key) => (payload[key] ?? '').trim() !== '');
  const hasArray = DRAFT_ARRAY_KEYS.some((key) =>
    (payload[key] ?? []).some((item) => item.trim() !== '')
  );
  return !hasString && !hasArray;
}

/** Label draf untuk daftar "lanjutkan draf": lokasi beli atau penanda waktu. */
export function draftLabelFrom(payload: DraftPayload, fallback: string): string {
  const market = (payload.marketSource ?? '').trim();
  return (market !== '' ? market : fallback).slice(0, 120);
}
