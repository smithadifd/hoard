import { NextResponse } from 'next/server';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getEnrichedGames } from '@/lib/db/queries';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await syncWishlist((processed, total) => {
          send('progress', { processed, total });
        });
        send('done', { gamesProcessed: result.gamesProcessed });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Wishlist sync failed';
        console.error('Wishlist sync failed:', error);
        send('error', { error: message });
      } finally {
        controller.close();
      }
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
export async function GET() {
  try {
    const { games, total } = getEnrichedGames({ view: 'wishlist' });
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
