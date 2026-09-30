import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/client.ts';
import { logger } from '../logging/logger.ts';
import type { AuthSession, User } from '@prisma/client';

export const SESSION_COOKIE_NAME = 'esniffer_session';
export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Gets authentication secret key.
 * Throws explicit error in production if AUTH_SECRET is not configured.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Missing mandatory environment variable: AUTH_SECRET in production');
    }
    return 'dev-auth-secret-change-in-production';
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters in production');
  }
  return secret;
}

/**
 * Generates an HMAC CSRF token derived from the session token.
 * Accepts either the raw session token or the pre-computed tokenHash.
 */
export function generateCsrfToken(rawOrHashToken: string, isHash: boolean = false): string {
  const secret = getAuthSecret();
  const tokenHash = isHash ? rawOrHashToken : hashToken(rawOrHashToken);
  return createHmac('sha256', secret).update(`csrf:${tokenHash}`).digest('hex');
}

/**
 * Validates a CSRF token using constant-time comparison.
 */
export function verifyCsrfToken(rawOrHashToken: string, providedToken: string, isHash: boolean = false): boolean {
  if (!rawOrHashToken || !providedToken || typeof providedToken !== 'string') {
    return false;
  }
  const expectedToken = generateCsrfToken(rawOrHashToken, isHash);
  if (expectedToken.length !== providedToken.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedToken), Buffer.from(providedToken));
}

/**
 * Computes SHA-256 hash of opaque token to be stored in database.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface SessionWithUser {
  session: AuthSession;
  user: User;
}

/**
 * Creates a new opaque session for a user.
 * Returns the raw token (sent only to client via HttpOnly cookie) and session details.
 */
export async function createSession(
  userId: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<{ rawToken: string; expiresAt: Date; session: AuthSession }> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);

  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return { rawToken, expiresAt, session };
}

/**
 * Validates an opaque raw session token.
 * Verifies that the session exists, is not revoked, has not expired,
 * and that the associated user is active.
 */
export async function validateSession(rawToken: string): Promise<SessionWithUser | null> {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const tokenHash = hashToken(rawToken);
  const session = await prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  // Check revocation
  if (session.revokedAt !== null) {
    return null;
  }

  // Check expiry
  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  // Check user active status
  if (!session.user.isActive) {
    return null;
  }

  // Throttled touch of lastUsedAt (at most once every 5 minutes)
  const now = Date.now();
  if (!session.lastUsedAt || now - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    prisma.authSession
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now) },
      })
      .catch((err: unknown) => {
        logger.warn({
          service: 'web',
          operation: 'touch_session',
          outcome: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }

  return { session, user: session.user };
}

/**
 * Revokes a session given the raw token.
 */
export async function revokeSession(rawToken: string): Promise<boolean> {
  if (!rawToken || typeof rawToken !== 'string') {
    return false;
  }

  const tokenHash = hashToken(rawToken);
  try {
    await prisma.authSession.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds standard Set-Cookie string for the session token.
 */
export function buildSessionCookie(rawToken: string, expiresAt: Date): string {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secureFlag = isProd ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

/**
 * Builds clear-cookie header for logout.
 */
export function buildClearSessionCookie(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`;
}
