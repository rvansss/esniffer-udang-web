import { createServer, type Server } from 'node:http';

export interface WorkerHealthProbe {
  isLive(): boolean;
  isReady(): Promise<boolean>;
}

function json(status: number, body: { status: string }): { status: number; body: string } {
  return { status, body: JSON.stringify(body) };
}

export function createWorkerHealthServer(probe: WorkerHealthProbe): Server {
  return createServer(async (request, response) => {
    let result: { status: number; body: string };
    if (request.method !== 'GET') {
      result = json(405, { status: 'method_not_allowed' });
    } else if (request.url === '/health/live') {
      result = probe.isLive()
        ? json(200, { status: 'live' })
        : json(503, { status: 'stopping' });
    } else if (request.url === '/health/ready') {
      try {
        result = await probe.isReady()
          ? json(200, { status: 'ready' })
          : json(503, { status: 'not_ready' });
      } catch {
        result = json(503, { status: 'not_ready' });
      }
    } else {
      result = json(404, { status: 'not_found' });
    }

    response.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(result.body);
  });
}
