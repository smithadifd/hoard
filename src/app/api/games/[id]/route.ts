import { NextResponse } from 'next/server';
import { getEnrichedGameById, updateUserGame } from '@/lib/db/queries';
import { gameIdSchema, gameUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/games/:id
 * Get full details for a specific game.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const game = getEnrichedGameById(idResult.data.id, userId);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ data: game });
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
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return NextResponse.json({ error: 'Invalid game ID' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = gameUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = updateUserGame(idResult.data.id, parsed.data, userId);
    if (!updated) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { message: 'Updated' } });
  } catch (error) {
    console.error('Failed to update game:', error);
    return NextResponse.json(
      { error: 'Failed to update game' },
      { status: 500 }
    );
  }
}
