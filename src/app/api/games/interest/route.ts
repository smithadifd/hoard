import { NextRequest, NextResponse } from 'next/server';
import { updateUserGame } from '@/lib/db/queries';

/**
 * POST /api/games/interest
 * Update a game's personal interest rating.
 * Body: { gameId: number, interest: number (1-5) }
 */
export async function POST(request: NextRequest) {
  try {
    const { gameId, interest } = await request.json();

    if (!gameId || typeof gameId !== 'number') {
      return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
    }

    if (!interest || typeof interest !== 'number' || interest < 1 || interest > 5) {
      return NextResponse.json({ error: 'interest must be 1-5' }, { status: 400 });
    }

    const updated = updateUserGame(gameId, { personalInterest: interest });

    if (!updated) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { gameId, interest } });
  } catch (error) {
    console.error('Failed to update interest:', error);
    const message = error instanceof Error ? error.message : 'Failed to update interest';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
