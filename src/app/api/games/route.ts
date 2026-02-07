import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/games
 * Query games with filters and pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const _search = searchParams.get('search');
    const _view = searchParams.get('view'); // library, wishlist, watchlist
    const _sortBy = searchParams.get('sortBy') || 'title';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '24');

    // TODO: Query database with filters

    return NextResponse.json({
      data: [],
      meta: { total: 0, page, pageSize },
    });
  } catch (error) {
    console.error('Failed to fetch games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
