import { NextResponse } from 'next/server';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 */
export async function POST() {
  try {
    // TODO: Implement wishlist sync
    return NextResponse.json({
      data: { message: 'Wishlist sync not yet implemented' },
    });
  } catch (error) {
    console.error('Wishlist sync failed:', error);
    return NextResponse.json(
      { error: 'Wishlist sync failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // TODO: Query games from database where isWishlisted = true
    return NextResponse.json({ data: [] });
  } catch (error) {
    console.error('Failed to fetch wishlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wishlist' },
      { status: 500 }
    );
  }
}
