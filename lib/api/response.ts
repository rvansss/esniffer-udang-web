import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.ts';
import { logger } from '../logging/logger.ts';

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown[];
    requestId: string;
  };
}

export interface ApiSuccessEnvelope<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Extracts or generates a valid request ID.
 */
export function getRequestId(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  if (incoming && incoming.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

/**
 * JSON serializer replacer that safely handles BigInt and Date values.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Returns a standardized JSON success response.
 */
export function jsonResponse<T>(
  data: T,
  meta?: Record<string, unknown>,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  const body: ApiSuccessEnvelope<T> = { data };
  if (meta !== undefined) {
    body.meta = meta;
  }

  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store, private');
  }

  return new Response(JSON.stringify(body, jsonReplacer), {
    status,
    headers,
  });
}

/**
 * Kode PostgreSQL asli di balik pembungkusan error Prisma.
 *
 * Dengan driver adapter, `prisma.*` melempar PrismaClientKnownRequestError
 * yang `code`-nya kode Prisma (mis. P2039), sedangkan kode PostgreSQL asli ada
 * di `meta.driverAdapterError.cause.originalCode`. Tanpa membongkar bungkusan
 * itu, "23514" tidak pernah cocok dan pelanggaran aturan database jatuh ke
 * pesan generik 500.
 */
export function postgresErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const meta = (err as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return undefined;
  const adapter = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (typeof adapter !== 'object' || adapter === null) return undefined;
  const cause = (adapter as { cause?: unknown }).cause;
  const source = (typeof cause === 'object' && cause !== null ? cause : adapter) as Record<string, unknown>;
  for (const key of ['originalCode', 'code'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

/**
 * Handles errors uniformly, logs appropriately, and returns standard error envelope.
 */
export function errorResponse(err: unknown, requestId: string, request?: Request): Response {
  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'Terjadi kesalahan tak terduga di server. Coba lagi, lalu ulangi dengan requestId bila berulang.';
  let details: unknown[] | undefined;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof SyntaxError) {
    status = 400;
    code = 'MALFORMED_JSON';
    message = 'Invalid JSON in request body';
  } else if (typeof err === 'object' && err !== null) {
    const errCode = (err as { code?: unknown }).code;
    // Kode DB: prioritas kode PostgreSQL asli, fallback ke kode pada err
    // (error mentah tanpa pembungkusan Prisma sudah berisi kode PostgreSQL).
    const dbCode = postgresErrorCode(err) ?? (typeof errCode === 'string' ? errCode : undefined);
    if (errCode === 'P2002' || dbCode === '23505') {
      status = 409;
      code = 'UNIQUE_CONSTRAINT_VIOLATION';
      message = 'A resource with the specified unique field already exists';
    } else if (dbCode === '23P01') { // exclusion_violation
      status = 409;
      code = 'EXCLUSION_CONFLICT';
      message = 'Operation violates exclusion constraint (e.g. overlapping device assignment)';
    } else if (dbCode === '23514') { // check_violation
      // Aturan cek basis data (mis. urutan beli → berangkat → tiba) bocor ke
      // sini hanya jika lolos validasi aplikasi: laporkan sebagai 422, bukan 500.
      status = 422;
      code = 'VALIDATION_ERROR';
      message = 'Data tidak lolos salah satu aturan validasi penyimpanan.';
    } else if (errCode === 'ECONNREFUSED' || errCode === 'P1001' || dbCode === 'ECONNREFUSED') {
      status = 503;
      code = 'SERVICE_UNAVAILABLE';
      message = 'Database service is currently unreachable';
    }
  }

  // Log error with correlation requestId
  if (status >= 500) {
    logger.error({
      service: 'web',
      operation: request ? `${request.method} ${new URL(request.url).pathname}` : 'http_request',
      outcome: 'error',
      reason_code: code,
      correlation_id: requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  } else if (status >= 400) {
    logger.warn({
      service: 'web',
      operation: request ? `${request.method} ${new URL(request.url).pathname}` : 'http_request',
      outcome: 'client_error',
      reason_code: code,
      correlation_id: requestId,
      message,
    });
  }

  const envelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };

  const headers = new Headers();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('x-request-id', requestId);
  headers.set('Cache-Control', 'no-store, private');

  return new Response(JSON.stringify(envelope), {
    status,
    headers,
  });
}
