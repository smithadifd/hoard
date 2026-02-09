import { NextRequest, NextResponse } from 'next/server';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getEnrichedGames } from '@/lib/db/queries';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

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
        const result = await syncWishlist((processed, total, context) => {
          send('progress', { processed, total, ...context });
        }, abortController.signal, userId);
        send('done', { gamesProcessed: result.gamesProcessed, cancelled: abortController.signal.aborted });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Wishlist sync failed';
        console.error('Wishlist sync failed:', error);
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
 * GET /api/steam/wishlist
 * Returns the user's wishlist from the local database.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { games, total } = getEnrichedGames({ view: 'wishlist' }, undefined, undefined, userId);
    return NextResponse.json({
      data: games,
      meta: { total },
    });
  } catch (error) {
    console.error('Failed to fetch wishlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wishlist' },
      { status: 500 }
    );
  }
}
