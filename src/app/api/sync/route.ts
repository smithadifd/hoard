import { NextRequest, NextResponse } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getRecentSyncLogs } from '@/lib/db/queries';

/**
 * POST /api/sync
 * Trigger a manual sync operation.
 * Body: { type: 'library' | 'wishlist' | 'prices' | 'hltb' }
 */
export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json();

    switch (type) {
      case 'library': {
        const result = await syncLibrary();
        return NextResponse.json({
          data: { message: `Library sync completed`, gamesProcessed: result.gamesProcessed },
        });
      }
      case 'wishlist': {
        const result = await syncWishlist();
        return NextResponse.json({
          data: { message: `Wishlist sync completed`, gamesProcessed: result.gamesProcessed },
        });
      }
      case 'prices':
        // Phase 2
        return NextResponse.json({
          data: { message: 'Price sync not yet implemented (Phase 2)' },
        });
      case 'hltb':
        // Phase 3
        return NextResponse.json({
          data: { message: 'HLTB backfill not yet implemented (Phase 3)' },
        });
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
