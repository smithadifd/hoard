import { NextRequest, NextResponse } from 'next/server';
import { getEnrichedGames } from '@/lib/db/queries';
import { gameFiltersSchema, searchParamsToObject, formatZodError } from '@/lib/validations';

/**
 * GET /api/games
 * Query games with filters and pagination.
 */
export async function GET(request: NextRequest) {
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
    const result = getEnrichedGames(filters, page, pageSize);

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
