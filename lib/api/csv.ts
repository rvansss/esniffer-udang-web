/**
 * CSV Formatting, RFC 4180 Compliance, and Formula Injection Defense
 * Sesuai Section 7.7 docs/esniffer/03-technical-design.md
 */

export { toWibParts, toWibIso } from '../../shared/datetime.ts';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

const NEGATIVE_NUMBER_PATTERN = /^-\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Sanitizes a single CSV cell:
 * 1. Handles null/undefined cleanly as empty string.
 * 2. Numbers and negative numeric literals remain numeric (not converted to text).
 * 3. Neutralizes spreadsheet formula injection by prepending a single quote `'`
 *    for text starting with formula triggers (=, +, -, @, \t, \r).
 * 4. Escapes quotes and wraps in double-quotes if it contains commas, quotes, or newlines (RFC 4180).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Pure numbers (including negative numbers) remain numeric
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const str = String(value);

  // Negative numbers in string representation also remain numeric without single-quote prefix
  if (NEGATIVE_NUMBER_PATTERN.test(str.trim())) {
    return str.trim();
  }

  let formatted = str;

  // Formula injection defense for text: prepend single quote if starting with formula triggers
  if (formatted.length > 0 && FORMULA_TRIGGERS.includes(formatted.charAt(0))) {
    formatted = `'${formatted}`;
  }

  // RFC 4180 quoting
  if (formatted.includes('"') || formatted.includes(',') || formatted.includes('\n') || formatted.includes('\r')) {
    return `"${formatted.replace(/"/g, '""')}"`;
  }

  return formatted;
}

/**
 * Builds a single CRLF-terminated CSV row from an array of cells.
 */
export function buildCsvRow(cells: unknown[]): string {
  return cells.map(sanitizeCsvCell).join(',') + '\r\n';
}

/**
 * Penanda urutan byte UTF-8 di awal file. Excel Windows tidak mendeteksi
 * UTF-8 tanpa BOM sehingga simbol seperti ° tampil rusak (Â°); satu-satunya
 * cara yang didukung Excel agar CSV terbuka benar tanpa dialog impor.
 * Isi data tidak berubah, hanya 3 byte pertama file (EF BB BF).
 */
export const CSV_UTF8_BOM = '\uFEFF';

/**
 * Standard CSV headers for chamber readings export.
 */
export const READING_CSV_HEADERS = [
  'chamber_code',
  'device_id',
  'message_id',
  'measured_at',
  'received_at',
  'measurement_time_quality',
  'temperature_c_value',
  'temperature_c_unit',
  'temperature_c_quality',
  'humidity_percent_value',
  'humidity_percent_unit',
  'humidity_percent_quality',
  'mq137_raw_value',
  'mq137_raw_unit',
  'mq137_raw_quality',
  'mq136_raw_value',
  'mq136_raw_unit',
  'mq136_raw_quality',
  'mq4_raw_value',
  'mq4_raw_unit',
  'mq4_raw_quality',
  'ingestion_source',
  'measured_at_wib',
  'received_at_wib',
];

/**
 * Header CSV ML-ready untuk export batch dataset (PRD §3.4).
 * Kolom dasar snake_case English sesuai PRD, ditambah timestamp_wib; boolean is_baseline
 * diserialkan sebagai string 'true'/'false', null sebagai sel kosong.
 */
export const DATASET_CSV_HEADERS = [
  'timestamp_utc',
  'session_id',
  'batch_id',
  'source_type',
  'storage_condition',
  'timepoint_code',
  'elapsed_hours',
  'mq137_raw',
  'mq136_raw',
  'mq4_raw',
  'temp_chamber_c',
  'rh_chamber_pct',
  'is_baseline',
  'timestamp_wib',
];

/**
 * Header CSV ekspor hasil pengujian per sesi individual.
 * Menyertakan detik relatif dari awal pengujian, timestamp UTC & WIB,
 * respons sensor gas, suhu, kelembaban, serta observasi suhu & berat udang.
 */
export const SESSION_READINGS_CSV_HEADERS = [
  'detik_ke',
  'timestamp_utc',
  'waktu_wib',
  'session_id',
  'batch_id',
  'timepoint_code',
  'elapsed_hours',
  'mq137_raw',
  'mq136_raw',
  'mq4_raw',
  'temp_chamber_c',
  'rh_chamber_pct',
  'is_baseline',
  'shrimp_temp_c',
  'shrimp_weight_g',
];

/**
 * Header CSV metadata batch (satu baris per sesi, atau per grup bila belum
 * ada sesi). Selalu berisi data yang diisi operator di form, sehingga
 * pengguna tetap mendapat isiannya walau belum ada reading sensor.
 */
export const DATASET_METADATA_CSV_HEADERS = [
  'batch_id',
  // Revisi putaran 2 butir 5: timestamp dipecah menjadi kolom tanggal dan
  // kolom jam WIB terpisah (konversi di pembuat CSV). Revisi wizard:
  // keberangkatan ikut dicatat, jadi kolomnya mendahului beli.
  'departed_date',
  'departed_time_wib',
  'procured_date',
  'procured_time_wib',
  'market_source',
  'source_type',
  'shrimp_count',
  'size_grade',
  'shrimp_length_cm',
  'total_weight_g',
  'initial_condition',
  'initial_temp_c',
  'arrived_date',
  'arrived_time_wib',
  // Revisi: tiga titik pengukuran cool box (berangkat, pasar, lab).
  'cooler_temp_departure_c',
  'cooler_temp_market_c',
  'cooler_temp_lab_c',
  'ice_to_shrimp_ratio',
  'rejection_notes',
  'photo_count',
  'locked_at',
  'group_id',
  'storage_condition',
  'target_temp_c',
  'lab_temp_c',
  'visual_check',
  'lab_weight_before_g',
  'lab_weight_after_g',
  'sample_shrimp_count',
  'session_id',
  'timepoint_code',
  'elapsed_hours',
  'started_at_utc',
  'ended_at_utc',
  'session_status',
  'warmup_done',
  'cleaning_done',
  'baseline_mq137',
  'baseline_mq136',
  'baseline_mq4',
  'locked_at_wib',
  'started_at_wib',
  'ended_at_wib',
];

/**
 * Batas maksimum baris data per unduhan CSV (default: 200.000).
 * Cukup untuk >24 jam pembacaan sensor berkelanjutan pada 1-2 Hz (~86.400 - 172.800 baris).
 * Dapat di-override melalui environment variable MAX_EXPORT_ROWS.
 */
export const DEFAULT_MAX_EXPORT_ROWS = 200000;

export function getMaxExportRows(): number {
  const envVal = process.env.MAX_EXPORT_ROWS;
  if (envVal && !Number.isNaN(Number(envVal)) && Number(envVal) > 0) {
    return Number(envVal);
  }
  return DEFAULT_MAX_EXPORT_ROWS;
}

