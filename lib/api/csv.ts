/**
 * CSV Formatting, RFC 4180 Compliance, and Formula Injection Defense
 * Sesuai Section 7.7 docs/esniffer/03-technical-design.md
 */

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
];

/**
 * Header CSV ML-ready untuk export batch dataset (PRD §3.4).
 * Kolom snake_case English persis contoh PRD; boolean is_baseline
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
];

/**
 * Header CSV metadata batch (satu baris per sesi, atau per grup bila belum
 * ada sesi). Selalu berisi data yang diisi operator di form, sehingga
 * pengguna tetap mendapat isiannya walau belum ada reading sensor.
 */
export const DATASET_METADATA_CSV_HEADERS = [
  'batch_id',
  'procured_at_utc',
  'market_source',
  'source_type',
  'shrimp_count',
  'size_grade',
  'shrimp_length_cm',
  'total_weight_g',
  'initial_condition',
  'initial_temp_c',
  'arrived_at_utc',
  'cooler_temp_min_c',
  'cooler_temp_max_c',
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
  'shrimp_length_cm',
  'sample_shrimp_count',
  'sample_weight_g',
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
];
