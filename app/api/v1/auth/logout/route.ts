import { extractToken, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { revokeSession, buildClearSessionCookie } from '../../../../../lib/auth/session.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);

    const rawToken = extractToken(request);
    if (rawToken) {
      await revokeSession(rawToken);
    }

    return jsonResponse(
      { success: true },
      undefined,
      200,
      { 'Set-Cookie': buildClearSessionCookie() }
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
