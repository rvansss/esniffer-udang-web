import { validationError } from './errors.ts';

/** Batas snapshot lama boleh dipakai ulang, tetapi tidak boleh melewati data committed. */
export function parseSnapshotWatermark(value: string | null, current: bigint): bigint {
  if (value === null) return current;
  if (!/^\d{1,19}$/.test(value)) {
    throw validationError('snapshotWatermark harus bilangan bulat nonnegatif');
  }
  const snapshot = BigInt(value);
  if (snapshot > current) {
    throw validationError('snapshotWatermark melebihi snapshot saat ini');
  }
  return snapshot;
}

/**
 * Parses and bounds pagination limit query param.
 */
export function parseLimit(
  val: string | null,
  defaultValue = 50,
  maxLimit = 100
): number {
  if (val === null || val === undefined || val.trim() === '') {
    return defaultValue;
  }

  const num = parseInt(val, 10);
  if (isNaN(num) || num <= 0) {
    throw validationError(`Limit parameter must be a positive integer, received: "${val}"`);
  }

  if (num > maxLimit) {
    throw validationError(`Limit parameter cannot exceed maximum of ${maxLimit}, received: ${num}`);
  }

  return num;
}

/**
 * Parses and validates an ISO 8601 date string.
 */
export function parseIsoDate(
  val: string | null,
  fieldName: string,
  required = false
): Date | null {
  if (val === null || val === undefined || val === '') {
    if (required) {
      throw validationError(`Field "${fieldName}" is required and must be an ISO 8601 date string`);
    }
    return null;
  }

  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(val)) {
    throw validationError(`Field "${fieldName}" must be an ISO 8601 timestamp with timezone`);
  }
  const date = new Date(val);
  if (isNaN(date.getTime())) {
    throw validationError(`Field "${fieldName}" must be a valid ISO 8601 timestamp, received: "${val}"`);
  }

  return date;
}

/** Throws unless `from` is strictly earlier than `to`. */
function assertFromBeforeTo(from: Date, to: Date): void {
  if (from.getTime() >= to.getTime()) {
    throw validationError(
      `Parameter "from" (${from.toISOString()}) must be strictly earlier than "to" (${to.toISOString()})`
    );
  }
}

/**
 * Validates that `from` is strictly earlier than `to` and within maximum range.
 */
export function validateTimeRange(
  from: Date,
  to: Date,
  maxRangeMs: number = 31 * 24 * 60 * 60 * 1000 // default 31 days
): void {
  assertFromBeforeTo(from, to);

  const rangeMs = to.getTime() - from.getTime();
  if (rangeMs > maxRangeMs) {
    const days = Math.round(maxRangeMs / (24 * 60 * 60 * 1000));
    throw validationError(
      `Requested time range exceeds maximum allowed limit of ${days} days`
    );
  }
}

/**
 * Validates that `from` is strictly earlier than `to` and spans at most
 * `years` calendar year(s). The boundary is derived from `to` with real
 * calendar arithmetic — a leap day rolls from 29 Feb to 1 Mar automatically —
 * instead of a fixed millisecond constant such as 365 or 366 days.
 */
export function validateTimeRangeCalendar(
  from: Date,
  to: Date,
  years: number = 1
): void {
  assertFromBeforeTo(from, to);

  const limit = new Date(to.getTime());
  limit.setUTCFullYear(limit.getUTCFullYear() - years);
  if (from.getTime() < limit.getTime()) {
    throw validationError(
      `Requested time range exceeds maximum allowed limit of ${years} calendar year(s)`
    );
  }
}

/**
 * Parses string field with length bounds.
 */
export function parseRequiredString(
  val: unknown,
  fieldName: string,
  minLen = 1,
  maxLen = 255
): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw validationError(`Field "${fieldName}" is required and must be a non-empty string`);
  }

  const trimmed = val.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    throw validationError(
      `Field "${fieldName}" must be between ${minLen} and ${maxLen} characters long`
    );
  }

  return trimmed;
}

/**
 * Parses optional string field with length bounds.
 */
export function parseOptionalString(
  val: unknown,
  fieldName: string,
  maxLen = 500
): string | null {
  if (val === undefined || val === null || val === '') {
    return null;
  }

  if (typeof val !== 'string') {
    throw validationError(`Field "${fieldName}" must be a string`);
  }

  const trimmed = val.trim();
  if (trimmed.length > maxLen) {
    throw validationError(`Field "${fieldName}" exceeds maximum length of ${maxLen} characters`);
  }

  return trimmed;
}
