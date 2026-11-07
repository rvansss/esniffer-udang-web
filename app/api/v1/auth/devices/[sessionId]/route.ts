import { prisma } from '../../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../../lib/auth/guard.ts';
import { buildClearSessionCookie } from '../../../../../../lib/auth/session.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../lib/api/response.ts';
import { notFound } from '../../../../../../lib/api/errors.ts';

/**
 * Mencabut satu sesi/perangkat milik akun sendiri.
 *
 * Dipakai tombol "Keluarkan" di daftar perangkat aktif: HP yang tertinggal di
 * lab atau tab lama bisa dimatikan tanpa mengeluarkan semua perangkat lain —
 * hal yang tidak mungkin ketika semua orang berbagi satu akun dan cookie tidak
 * bisa dipisahkan.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { session } = await requireAuth(request, ['VIEWER', 'ADMIN']);
    const { sessionId } = await context.params;

    const target = await prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, revokedAt: true },
    });
    // Sesi milik akun lain diperlakukan sebagai tidak ada: jangan bocorkan
    // keberadaan sesi pengguna lain lewat perbedaan status.
    if (!target || target.userId !== session.userId) {
      throw notFound(`Session "${sessionId}" not found`);
    }

    const isSelf = target.id === session.id;
    if (!target.revokedAt) {
      await prisma.authSession.update({
        where: { id: target.id },
        data: { revokedAt: new Date() },
      });
    }

    const headers = new Headers();
    if (isSelf) headers.append('Set-Cookie', buildClearSessionCookie());
    return jsonResponse({ revoked: true, self: isSelf, sessionId: target.id }, undefined, 200, headers);
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
