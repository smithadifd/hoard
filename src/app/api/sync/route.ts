import { NextRequest, NextResponse } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { syncWishlist } from '@/lib/sync/wishlist';
import { syncPrices } from '@/lib/sync/prices';
import { syncHltb } from '@/lib/sync/hltb';
import { getRecentSyncLogs } from '@/lib/db/queries';

/**
 * Helper: wrap a sync function with SSE progress streaming.
 */
function streamSync(
  syncFn: (onProgress: (processed: number, total: number) => void) => Promise<{ gamesProcessed: number }>,
  label: string
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await syncFn((processed, total) => {
          send('progress', { processed, total });
        });
        send('done', { gamesProcessed: result.gamesProcessed });
      } catch (error) {
        const message = error instanceof Error ? error.message : `${label} sync failed`;
        console.error(`${label} sync failed:`, error);
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
 * POST /api/sync
 * Trigger a manual sync operation.
 * Body: { type: 'library' | 'wishlist' | 'prices' | 'hltb' }
 * Returns SSE stream with progress events.
 */
export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json();

    switch (type) {
      case 'library':
        return streamSync(syncLibrary, 'Library');
      case 'wishlist':
        return streamSync(syncWishlist, 'Wishlist');
      case 'prices':
        return streamSync(syncPrices, 'Price');
      case 'hltb':
        return streamSync(syncHltb, 'HLTB');
      default:
        return NextResponse.json(
          { error: `Unknown sync type: ${type}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Sync failed:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/sync
 * Get status of recent sync operations.
 */
export async function GET() {
  try {
    const logs = getRecentSyncLogs(20);
    return NextResponse.json({ data: logs });
  } catch (error) {
    console.error('Failed to fetch sync status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    );
  }
}
