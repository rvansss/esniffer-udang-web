import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth } from '../../../../../lib/auth/guard.ts';
import { maxActiveSessions } from '../../../../../lib/auth/session.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';

/**
 * Daftar perangkat yang sedang memakai akun ini.
 *
 * Satu akun memang dipakai bergiliran di beberapa perangkat (HP di chamber,
 * laptop di lab). Daftar ini menjawab dua kebutuhan sekaligus: "berapa sesi
 * aktif sekarang" dan "perangkat mana yang harus dicabut" saat ada HP yang
 * tertinggal atau hilang. token_hash tidak pernah ikut dikirim.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const { session } = await requireAuth(request, ['VIEWER', 'ADMIN']);

    const rows = await prisma.authSession.findMany({
      where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        deviceId: true,
        deviceLabel: true,
        operatorName: true,
        lastUsedAt: true,
        lastIp: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return jsonResponse(
      rows.map((row) => ({
        id: row.id,
        deviceId: row.deviceId,
        deviceLabel: row.deviceLabel ?? 'Perangkat tanpa label',
        operatorName: row.operatorName,
        lastUsedAt: row.lastUsedAt.toISOString(),
        lastIp: row.lastIp,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        current: row.id === session.id,
      })),
      { count: rows.length, limit: maxActiveSessions() }
    );
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
