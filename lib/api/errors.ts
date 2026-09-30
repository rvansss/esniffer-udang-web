export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown[];

  constructor(status: number, code: string, message: string, details?: unknown[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message = 'Bad request', details?: unknown[]): HttpError {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Authentication required'): HttpError {
  return new HttpError(401, 'UNAUTHENTICATED', message);
}

export function forbidden(message = 'Access denied: insufficient permissions'): HttpError {
  return new HttpError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Resource not found'): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

export function conflict(message = 'Resource conflict', details?: unknown[]): HttpError {
  return new HttpError(409, 'CONFLICT', message, details);
}

export function payloadTooLarge(message = 'Export or payload exceeds maximum allowed size'): HttpError {
  return new HttpError(413, 'PAYLOAD_TOO_LARGE', message);
}

export function validationError(message = 'Validation failed', details?: unknown[]): HttpError {
  return new HttpError(422, 'VALIDATION_ERROR', message, details);
}

export function serviceUnavailable(message = 'Database or service temporarily unavailable'): HttpError {
  return new HttpError(503, 'SERVICE_UNAVAILABLE', message);
}
