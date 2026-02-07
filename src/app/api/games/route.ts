import { NextRequest, NextResponse } from 'next/server';
import { getEnrichedGames } from '@/lib/db/queries';
import type { GameFilters } from '@/types';

/**
 * GET /api/games
 * Query games with filters and pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: GameFilters = {
      search: searchParams.get('search') || undefined,
      view: (searchParams.get('view') as GameFilters['view']) || undefined,
      owned: searchParams.has('owned') ? searchParams.get('owned') === 'true' : undefined,
      played: searchParams.has('played') ? searchParams.get('played') === 'true' : undefined,
      maxHours: searchParams.has('maxHours') ? Number(searchParams.get('maxHours')) : undefined,
      minHours: searchParams.has('minHours') ? Number(searchParams.get('minHours')) : undefined,
      coop: searchParams.has('coop') ? searchParams.get('coop') === 'true' : undefined,
      multiplayer: searchParams.has('multiplayer') ? searchParams.get('multiplayer') === 'true' : undefined,
      minReview: searchParams.has('minReview') ? Number(searchParams.get('minReview')) : undefined,
      maxPrice: searchParams.has('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
      onSale: searchParams.has('onSale') ? searchParams.get('onSale') === 'true' : undefined,
      sortBy: (searchParams.get('sortBy') as GameFilters['sortBy']) || 'title',
      sortOrder: (searchParams.get('sortOrder') as GameFilters['sortOrder']) || 'asc',
    };

    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '24');

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
