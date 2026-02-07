import { NextResponse } from 'next/server';

/**
 * POST /api/steam/library
 * Triggers a sync of the user's Steam library.
 *
 * Phase 1 implementation.
 */
export async function POST() {
  try {
    // TODO: Implement library sync
    // 1. Fetch owned games from Steam API
    // 2. Upsert games into database
    // 3. Update playtime data
    // 4. Log sync operation

    return NextResponse.json({
      data: { message: 'Library sync not yet implemented' },
    });
  } catch (error) {
    console.error('Library sync failed:', error);
    return NextResponse.json(
      { error: 'Library sync failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/steam/library
 * Returns the user's library from the local database.
 */
export async function GET() {
  try {
    // TODO: Query games from database where isOwned = true

    return NextResponse.json({ data: [] });
  } catch (error) {
    console.error('Failed to fetch library:', error);
    return NextResponse.json(
      { error: 'Failed to fetch library' },
      { status: 500 }
    );
  }
}
