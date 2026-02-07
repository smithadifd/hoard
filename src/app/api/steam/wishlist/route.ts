import { NextResponse } from 'next/server';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getEnrichedGames } from '@/lib/db/queries';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 */
export async function POST() {
  try {
    const result = await syncWishlist();
    return NextResponse.json({
      data: {
        message: 'Wishlist sync completed',
        gamesProcessed: result.gamesProcessed,
      },
    });
  } catch (error) {
    console.error('Wishlist sync failed:', error);
    const message = error instanceof Error ? error.message : 'Wishlist sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
