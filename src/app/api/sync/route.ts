import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/sync
 * Trigger a manual sync operation.
 * Body: { type: 'library' | 'wishlist' | 'prices' | 'hltb' }
 */
export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json();

    switch (type) {
      case 'library':
        // TODO: Trigger library sync
        break;
      case 'wishlist':
        // TODO: Trigger wishlist sync
        break;
      case 'prices':
        // TODO: Trigger price check
        break;
      case 'hltb':
        // TODO: Trigger HLTB backfill
        break;
      default:
        return NextResponse.json(
          { error: `Unknown sync type: ${type}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      data: { message: `${type} sync triggered` },
    });
  } catch (error) {
    console.error('Sync failed:', error);
    return NextResponse.json(
      { error: 'Sync failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync
 * Get status of sync operations.
 */
export async function GET() {
  try {
    // TODO: Query syncLog table for recent operations
    return NextResponse.json({ data: [] });
  } catch (error) {
    console.error('Failed to fetch sync status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    );
  }
}
