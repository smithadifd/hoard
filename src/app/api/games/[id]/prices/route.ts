import { NextResponse } from 'next/server';
import { getPriceHistory } from '@/lib/db/queries';

/**
 * GET /api/games/:id/prices
 * Returns price history for a specific game.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gameId = parseInt(id);
    if (isNaN(gameId)) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const history = getPriceHistory(gameId);
    return NextResponse.json({ data: history });
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price history' },
      { status: 500 }
    );
  }
}
