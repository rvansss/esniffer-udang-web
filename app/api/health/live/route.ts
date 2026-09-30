export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(
    { status: 'live' },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store, private' },
    }
  );
}
