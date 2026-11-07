import { randomUUID } from 'node:crypto';
import { requireAuth } from '../../../../../lib/auth/guard.ts';
import { generateCsrfToken } from '../../../../../lib/auth/session.ts';
import { buildDeviceCookie, resolveAttribution } from '../../../../../lib/auth/attribution.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';

/**
 * Profil sesi untuk klien: user, CSRF, perangkat, dan operator yang tercatat.
 * Endpoint ini juga menerbitkan cookie identitas perangkat bila belum ada,
 * sehingga perangkat lama yang login sebelum fitur ini tetap punya device_id.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const { user, session } = await requireAuth(request);
    const attribution = resolveAttribution(request);
    const deviceId = session.deviceId ?? attribution.deviceId ?? randomUUID();

    const cookies = new Headers();
    if (attribution.deviceId !== deviceId) {
      cookies.append('Set-Cookie', buildDeviceCookie(deviceId));
    }

    return jsonResponse(
      {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        csrfToken: generateCsrfToken(session.tokenHash, true),
        expiresAt: session.expiresAt.toISOString(),
        sessionId: session.id,
        device: {
          id: deviceId,
          label: session.deviceLabel ?? attribution.deviceLabel,
        },
        operator: session.operatorName ?? attribution.operator,
      },
      undefined,
      200,
      cookies
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
