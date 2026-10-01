import {
  SESSION_COOKIE_NAME,
  validateSession,
  verifyCsrfToken,
  hashToken,
  type SessionWithUser,
} from './session.ts';
import { unauthorized, forbidden } from '../api/errors.ts';
import type { UserRole } from '@prisma/client';

/**
 * Extracts raw session token from Cookie header or Bearer authorization.
 */
export function extractToken(request: Request): string | null {
  // 1. Check Cookie header
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.split('=');
      if (name === SESSION_COOKIE_NAME) {
        return rest.join('=');
      }
    }
  }

  // 2. Check Authorization: Bearer <token> header
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return null;
}

/**
 * Detects whether authentication token came from Cookie or Bearer header.
 */
export function extractTokenSource(request: Request): 'cookie' | 'bearer' | null {
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      const [name] = cookie.split('=');
      if (name === SESSION_COOKIE_NAME) {
        return 'cookie';
      }
    }
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return 'bearer';
  }

  return null;
}

/**
 * Validates the request's session and returns authenticated user and session, or null.
 */
export async function getAuthenticatedUser(request: Request): Promise<SessionWithUser | null> {
  const token = extractToken(request);
  if (!token) {
    return null;
  }
  return validateSession(token);
}

/**
 * Enforces authentication and role-based access control.
 * Throws 401 if unauthenticated, 403 if user lacks required role.
 */
export async function requireAuth(
  request: Request,
  allowedRoles: UserRole[] = ['VIEWER', 'ADMIN']
): Promise<SessionWithUser> {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    throw unauthorized('Authentication required to access this resource');
  }

  if (!allowedRoles.includes(auth.user.role)) {
    throw forbidden(`Role ${auth.user.role} is not permitted to perform this action`);
  }

  return auth;
}

/**
 * Checks whether an origin string is allowed based on APP_BASE_URL, APP_ORIGIN_ALLOWLIST,
 * and current environment.
 * In production, localhost loopback is NOT universally permitted.
 */
export function isOriginAllowed(originStr: string, requestHost?: string | null): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(originStr);
  } catch {
    return false;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // 1. In non-production only, allow loopback addresses on any port
  if (!isProduction) {
    if (
      originUrl.hostname === 'localhost' ||
      originUrl.hostname === '127.0.0.1' ||
      originUrl.hostname === '[::1]'
    ) {
      return true;
    }
    // Also allow same-host in dev/test
    if (requestHost && originUrl.host === requestHost) {
      return true;
    }
  }

  // 2. Allow origins configured via APP_BASE_URL
  if (process.env.APP_BASE_URL) {
    try {
      const base = new URL(process.env.APP_BASE_URL);
      if (originUrl.origin === base.origin) {
        return true;
      }
      if (requestHost && requestHost === base.host && originUrl.host === base.host) {
        return true;
      }
    } catch {}
  }

  // 3. Allow origins configured via APP_ORIGIN_ALLOWLIST (comma separated)
  if (process.env.APP_ORIGIN_ALLOWLIST) {
    const list = process.env.APP_ORIGIN_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of list) {
      try {
        const itemUrl = new URL(item);
        if (originUrl.origin === itemUrl.origin) {
          return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Validates Origin and Referer for state-mutating requests (POST, PATCH, PUT, DELETE).
 * Unallowed origins are rejected immediately, regardless of any custom headers.
 */
export function verifyOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return;
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  // If Origin header is present, it MUST match allowlist.
  // Custom headers (x-csrf-token, etc.) DO NOT bypass this check!
  if (origin) {
    if (!isOriginAllowed(origin, host)) {
      throw forbidden('Cross-origin request rejected');
    }
    return;
  }

  // If Referer header is present, its origin must match allowlist.
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (!isOriginAllowed(refererOrigin, host)) {
        throw forbidden('Cross-origin request rejected');
      }
    } catch {
      throw forbidden('Invalid Referer header');
    }
    return;
  }

  // If neither Origin nor Referer is present:
  // For requests using ambient credentials (Cookie), require Origin or Referer.
  const tokenSource = extractTokenSource(request);
  if (tokenSource === 'cookie') {
    throw forbidden('Missing valid Origin or CSRF header for state-mutating request');
  }
}

/**
 * Validates Origin / Referer and CSRF tokens on state-mutating requests (POST, PATCH, PUT, DELETE).
 * If a CSRF token header is present, validates it cryptographically against the session.
 */
export function verifyCsrfAndOrigin(request: Request, sessionTokenHash?: string): void {
  verifyOrigin(request);

  // If x-csrf-token header is present, validate it
  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) {
    let hashToVerify = sessionTokenHash;
    if (!hashToVerify) {
      const rawToken = extractToken(request);
      if (rawToken) {
        hashToVerify = hashToken(rawToken);
      }
    }

    if (!hashToVerify || !verifyCsrfToken(hashToVerify, csrfToken, true)) {
      throw forbidden('Invalid CSRF token');
    }
  }
}
