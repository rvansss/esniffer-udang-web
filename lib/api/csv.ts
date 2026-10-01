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
