/**
 * Centralized Structured Logger untuk e-Sniffer Udang Web & Worker
 * Menghasilkan satu JSON object per event ke stdout/stderr.
 * Mendukung redaksi field rahasia, pembatasan panjang string,
 * dan peredaman (suppression) duplikasi error berulang saat outage.
 *
 * Sesuai KNF-LOG-001 dan docs/esniffer/03-technical-design.md Section 12.1
 */

import { getLogContext, type LogContext } from './context.ts';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'cookie',
  'authorization',
  'database_url',
  'credential',
  'csrf',
  'password_hash',
  'raw_payload', // Payload mentah sensor tidak dicetak ke log umum
]);

const MAX_STRING_LENGTH = 256;

export interface LogEventDetails {
  service?: 'worker' | 'web' | 'test';
  operation: string;
  outcome?: string;
  reason_code?: string;
  duration_ms?: number;
  message?: string;
  device_id?: string;
  message_id?: string;
  reading_id?: string;
  [key: string]: unknown;
}

// State untuk outage rate limiting / error suppression
interface ErrorSuppressionState {
  count: number;
  firstSeenAt: number;
  lastReportedAt: number;
}
const errorSuppressionMap = new Map<string, ErrorSuppressionState>();
const ERROR_SUPPRESSION_WINDOW_MS = 5000;

export function resetErrorSuppressionForTesting(): void {
  errorSuppressionMap.clear();
}

export class StructuredLogger {
  private minLevel: LogLevel = 'INFO';
  private defaultService: 'worker' | 'web' | 'test' = 'worker';

  constructor(options?: { minLevel?: LogLevel; service?: 'worker' | 'web' | 'test' }) {
    if (options?.minLevel) this.minLevel = options.minLevel;
    if (options?.service) this.defaultService = options.service;
  }

  public setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Melakukan sanitasi nilai:
   * - Redaksi field rahasia ([REDACTED])
   * - Pemotongan string panjang > 256 karakter
   * - Konversi Error ke safe representation (name, message, code)
   */
  public sanitize(key: string, val: unknown, depth = 0): unknown {
    if (depth > 5) return '[NESTED_OBJECT]';

    const lowerKey = key.toLowerCase();
    for (const sens of SENSITIVE_KEYS) {
      if (lowerKey.includes(sens)) {
        return '[REDACTED]';
      }
    }

    if (val === null || val === undefined) return val;

    if (typeof val === 'string') {
      if (val.length > MAX_STRING_LENGTH) {
        return val.slice(0, MAX_STRING_LENGTH) + '...[TRUNCATED]';
      }
      return val;
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      return val;
    }

    if (val instanceof Error) {
      return {
        name: val.name,
        message: this.sanitize('message', val.message, depth + 1),
        code: (val as unknown as { code?: string }).code,
      };
    }

    if (Array.isArray(val)) {
      return val.slice(0, 20).map((item) => this.sanitize(key, item, depth + 1));
    }

    if (typeof val === 'object') {
      const sanitizedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        sanitizedObj[k] = this.sanitize(k, v, depth + 1);
      }
      return sanitizedObj;
    }

    return String(val);
  }

  private write(level: LogLevel, details: LogEventDetails): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    // Ambil konteks korelasi thread/request saat ini
    const context: LogContext = getLogContext();

    const timestamp = new Date().toISOString();
    const service = details.service || context.service || this.defaultService;

    // Outage suppression untuk ERROR identik
    if (level === 'ERROR') {
      const suppressionKey = `${service}:${details.operation}:${details.reason_code || 'GENERIC'}`;
      const now = Date.now();
      const state = errorSuppressionMap.get(suppressionKey);

      if (state) {
        if (now - state.firstSeenAt < ERROR_SUPPRESSION_WINDOW_MS) {
          state.count++;
          return; // Suppress repetitive error
        } else {
          // Window berakhir, keluarkan rekap
          const suppressedCount = state.count;
          errorSuppressionMap.delete(suppressionKey);
          if (suppressedCount > 1) {
            this.write('WARN', {
              service,
              operation: details.operation,
              message: `Suppressed ${suppressedCount - 1} repetitive errors in the last ${Math.round(
                ERROR_SUPPRESSION_WINDOW_MS / 1000
              )}s for operation "${details.operation}"`,
              reason_code: details.reason_code,
            });
          }
        }
      } else {
        errorSuppressionMap.set(suppressionKey, { count: 1, firstSeenAt: now, lastReportedAt: now });
      }
    }

    const logObject: Record<string, unknown> = {
      timestamp,
      level,
      service,
      operation: details.operation,
      outcome: details.outcome ?? null,
      reason_code: details.reason_code ?? null,
      correlation_id: context.correlationId || context.requestId || null,
      device_id: details.device_id || context.deviceId || null,
      message_id: details.message_id || context.messageId || null,
      reading_id: details.reading_id || context.readingId || null,
      duration_ms: details.duration_ms !== undefined ? details.duration_ms : null,
    };

    // Tambahkan properti tambahan yang telah disanitasi
    for (const [k, v] of Object.entries(details)) {
      if (!(k in logObject)) {
        logObject[k] = this.sanitize(k, v);
      }
    }

    const output = JSON.stringify(logObject);
    if (level === 'ERROR') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  public debug(details: LogEventDetails): void {
    this.write('DEBUG', details);
  }

  public info(details: LogEventDetails): void {
    this.write('INFO', details);
  }

  public warn(details: LogEventDetails): void {
    this.write('WARN', details);
  }

  public error(details: LogEventDetails): void {
    this.write('ERROR', details);
  }
}

export const logger = new StructuredLogger();
