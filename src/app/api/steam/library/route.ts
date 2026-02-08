import { NextRequest, NextResponse } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { getEnrichedGames } from '@/lib/db/queries';

/**
 * POST /api/steam/library
 * Triggers a sync of the user's Steam library.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  request.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed
        }
      };

      try {
        const result = await syncLibrary((processed, total, context) => {
          send('progress', { processed, total, ...context });
        }, abortController.signal);
        send('done', { gamesProcessed: result.gamesProcessed, cancelled: abortController.signal.aborted });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Library sync failed';
        console.error('Library sync failed:', error);
        send('error', { error: message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * GET /api/steam/library
 * Returns the user's library from the local database.
 */
export async function GET() {
  try {
    const { games, total } = getEnrichedGames({ view: 'library' });
    return NextResponse.json({
      data: games,
      meta: { total },
    });
  } catch (error) {
    console.error('Failed to fetch library:', error);
    return NextResponse.json(
      { error: 'Failed to fetch library' },
      { status: 500 }
    );
  }
}
