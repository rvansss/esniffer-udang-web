import { requireAuth } from '../../../../../lib/auth/guard.ts';
import { generateCsrfToken } from '../../../../../lib/auth/session.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const { user, session } = await requireAuth(request);

    return jsonResponse({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      csrfToken: generateCsrfToken(session.tokenHash, true),
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
