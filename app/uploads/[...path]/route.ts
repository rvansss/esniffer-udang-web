import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path: segments } = await context.params;

    if (!Array.isArray(segments) || segments.length === 0) {
      return new Response('Not Found', { status: 404 });
    }

    // Anti-traversal & validation
    for (const segment of segments) {
      if (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\') ||
        segment.includes('\0')
      ) {
        return new Response('Bad Request', { status: 400 });
      }
    }

    const uploadsBase = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.resolve(uploadsBase, ...segments);

    // Ensure resolved path is strictly within uploadsBase
    if (!filePath.startsWith(uploadsBase + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext];
    if (!contentType) {
      return new Response('Not Found', { status: 404 });
    }

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return new Response('Not Found', { status: 404 });
    }

    const fileBuffer = await readFile(filePath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileBuffer.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const getRes = await GET(_request, context);
  return new Response(null, {
    status: getRes.status,
    headers: getRes.headers,
  });
}
