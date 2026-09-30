import { validationError } from './errors.ts';

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
  if (!val || val.trim() === '') {
    if (required) {
      throw validationError(`Field "${fieldName}" is required and must be an ISO 8601 date string`);
    }
    return null;
  }

  const date = new Date(val);
  if (isNaN(date.getTime())) {
    throw validationError(`Field "${fieldName}" must be a valid ISO 8601 timestamp, received: "${val}"`);
  }

  return date;
}

/**
 * Validates that `from` is strictly earlier than `to` and within maximum range.
 */
export function validateTimeRange(
  from: Date,
  to: Date,
  maxRangeMs: number = 31 * 24 * 60 * 60 * 1000 // default 31 days
): void {
  if (from.getTime() >= to.getTime()) {
    throw validationError(
      `Parameter "from" (${from.toISOString()}) must be strictly earlier than "to" (${to.toISOString()})`
    );
  }

  const rangeMs = to.getTime() - from.getTime();
  if (rangeMs > maxRangeMs) {
    const days = Math.round(maxRangeMs / (24 * 60 * 60 * 1000));
    throw validationError(
      `Requested time range exceeds maximum allowed limit of ${days} days`
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
