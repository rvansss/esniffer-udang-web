import { requireAuth, verifyCsrfAndOrigin } from '../../../../../lib/auth/guard.ts';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../lib/api/response.ts';
import { deleteBatch, parseBatchIds, type BatchDeleteResult } from '../../../../../lib/dataset/batches.ts';

/**
 * Hapus banyak batch sekaligus (ADMIN). Tiap batch diproses sendiri-sendiri
 * (aman bila sebagian gagal): hasilnya per batchId, bukan all-or-nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    verifyCsrfAndOrigin(request);
    await requireAuth(request, ['ADMIN']);

    const body = await request.json();
    const batchIds = parseBatchIds(body?.batchIds);
    const force = body?.force === true;

    const results: BatchDeleteResult[] = [];
    for (const batchId of batchIds) {
      results.push(await deleteBatch(batchId, force));
    }

    const deleted = results.filter((r) => r.deleted).length;
    return jsonResponse(results, { total: results.length, deleted, failed: results.length - deleted });
  } catch (err) {
    return errorResponse(err, requestId, request);
  }
}
