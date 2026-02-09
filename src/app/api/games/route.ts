import { NextRequest, NextResponse } from 'next/server';
import { getEnrichedGames } from '@/lib/db/queries';
import { gameFiltersSchema, searchParamsToObject, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/games
 * Query games with filters and pagination.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const raw = searchParamsToObject(request.nextUrl.searchParams);
    const parsed = gameFiltersSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: formatZodError(parsed.error) },
        { status: 400 }
      );
    }

    const { page, pageSize, ...filters } = parsed.data;
    const result = getEnrichedGames(filters, page, pageSize, userId);

    return NextResponse.json({
      data: result.games,
      meta: { total: result.total, page, pageSize },
    });
  } catch (error) {
    console.error('Failed to fetch games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
