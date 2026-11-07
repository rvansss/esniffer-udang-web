import { prisma } from '../../../../../lib/db/client.ts';
import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { normalizeOperator, OPERATOR_FALLBACK } from '../../../../../lib/auth/attribution.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { validationError } from '../../../../../lib/api/errors.ts';

/**
 * Mengganti operator yang memegang perangkat ini.
 *
 * Satu akun dipakai bergantian beberapa operator, jadi identitas orang tidak
 * boleh hanya hidup di browser: nilai ini disimpan pada sesi perangkat
 * (`auth_sessions.operator_name`), sehingga setelah reload — atau saat
 * perangkat dipakai orang berikutnya — label yang tercatat di dataset tetap
 * benar. Nama kosong berarti "belum diisi" dan jatuh ke "Tanpa nama".
 */
export async function PATCH(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    const { session } = await requireAuth(request, ['VIEWER', 'ADMIN']);

    const body = await request.json().catch(() => undefined);
    const raw = (body as { operator?: unknown } | undefined)?.operator;
    if (typeof raw !== 'string') {
      throw validationError('Field "operator" wajib berupa teks');
    }

    const operator = normalizeOperator(raw);
    await prisma.authSession.update({
      where: { id: session.id },
      data: { operatorName: operator, lastUsedAt: new Date() },
    });

    // "Tanpa nama" adalah nilai bawaan, bukan nama yang dipilih pengguna.
    return jsonResponse({ operator: operator === OPERATOR_FALLBACK ? '' : operator });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
