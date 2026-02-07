import { NextResponse } from 'next/server';

/**
 * GET /api/games/:id
 * Get full details for a specific game.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const gameId = parseInt(params.id);
    if (isNaN(gameId)) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    // TODO: Fetch game from database with all related data

    return NextResponse.json({ data: null });
  } catch (error) {
    console.error('Failed to fetch game:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/games/:id
 * Update user-specific game data (interest, notes, watchlist status).
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const gameId = parseInt(params.id);
    if (isNaN(gameId)) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const body = await request.json();

    // TODO: Update userGames record

    return NextResponse.json({ data: { message: 'Updated' } });
  } catch (error) {
    console.error('Failed to update game:', error);
    return NextResponse.json(
      { error: 'Failed to update game' },
      { status: 500 }
    );
  }
}
