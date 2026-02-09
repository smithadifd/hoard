import { NextRequest, NextResponse } from 'next/server';
import { updateUserGame } from '@/lib/db/queries';
import { interestSchema, formatZodError } from '@/lib/validations';

/**
 * POST /api/games/interest
 * Update a game's personal interest rating.
 * Body: { gameId: number, interest: number (1-5) }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = interestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { gameId, interest } = parsed.data;
    const updated = updateUserGame(gameId, { personalInterest: interest });

    if (!updated) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { gameId, interest } });
  } catch (error) {
    console.error('Failed to update interest:', error);
    return NextResponse.json(
      { error: 'Failed to update interest' },
      { status: 500 }
    );
  }
}
