import { prisma } from '../../../../../lib/db/client.ts';
import { verifyPassword } from '../../../../../lib/auth/password.ts';
import { createSession, buildSessionCookie, generateCsrfToken } from '../../../../../lib/auth/session.ts';
import { verifyOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { unauthorized, validationError } from '../../../../../lib/api/errors.ts';

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyOrigin(request);
    const body = await request.json();
    const { email, password } = body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      throw validationError('Email and password must be non-empty strings');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      throw unauthorized('Invalid email or password');
    }

    // Check account lockout if lockedUntil is active
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw unauthorized('Account is temporarily locked. Please try again later.');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      // Increment failed count
      const failedCount = user.failedLoginCount + 1;
      const lockedUntil = failedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failedCount, lockedUntil },
      });
      throw unauthorized('Invalid email or password');
    }

    // Reset failed counter and update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { rawToken, expiresAt } = await createSession(user.id);
    const cookieHeader = buildSessionCookie(rawToken, expiresAt);
    const csrfToken = generateCsrfToken(rawToken);

    return jsonResponse(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        csrfToken,
        expiresAt: expiresAt.toISOString(),
      },
      undefined,
      200,
      { 'Set-Cookie': cookieHeader }
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
