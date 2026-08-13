import { NextRequest } from 'next/server';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getEnrichedGames } from '@/lib/db/queries';
import { apiSuccess, apiError, withAuth } from '@/lib/utils/api';
import { createSyncSSEResponse } from '@/lib/utils/sse';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (userId) => {
    return createSyncSSEResponse(syncWishlist, 'Wishlist', request, userId);
  });
}

/**
 * GET /api/steam/wishlist
 * Returns the user's wishlist from the local database.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (userId) => {
    try {
      const { games, total } = getEnrichedGames({ view: 'wishlist' }, undefined, undefined, userId);
      return apiSuccess(games, { total });
    } catch (error) {
      console.error('[GET /api/steam/wishlist]', error);
      return apiError('Failed to fetch wishlist');
    }
  });
}
