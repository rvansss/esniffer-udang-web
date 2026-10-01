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
 * Handles errors uniformly, logs appropriately, and returns standard error envelope.
 */
export function errorResponse(err: unknown, requestId: string, request?: Request): Response {
  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
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
  } else if (typeof err === 'object' && err !== null && 'code' in err) {
    // Prisma or PostgreSQL known codes
    const dbErr = err as { code?: string; message?: string };
    if (dbErr.code === 'P2002') {
      status = 409;
      code = 'UNIQUE_CONSTRAINT_VIOLATION';
      message = 'A resource with the specified unique field already exists';
    } else if (dbErr.code === '23P01') { // exclusion_violation
      status = 409;
      code = 'EXCLUSION_CONFLICT';
      message = 'Operation violates exclusion constraint (e.g. overlapping device assignment)';
    } else if (dbErr.code === 'ECONNREFUSED' || dbErr.code === 'P1001') {
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
