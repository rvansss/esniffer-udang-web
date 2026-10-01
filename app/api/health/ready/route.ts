import { prisma } from '../../../../lib/db/client.ts';
import { validateWebRuntimeConfig } from '../../../../lib/runtime/config.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    validateWebRuntimeConfig();
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      { status: 'ready' },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  } catch {
    return Response.json(
      { status: 'not_ready' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }
}
