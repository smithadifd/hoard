import { NextResponse } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { getEnrichedGames } from '@/lib/db/queries';

/**
 * POST /api/steam/library
 * Triggers a sync of the user's Steam library.
 */
export async function POST() {
  try {
    const result = await syncLibrary();
    return NextResponse.json({
      data: {
        message: 'Library sync completed',
        gamesProcessed: result.gamesProcessed,
      },
    });
  } catch (error) {
    console.error('Library sync failed:', error);
    const message = error instanceof Error ? error.message : 'Library sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
