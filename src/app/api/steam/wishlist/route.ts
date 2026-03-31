import { NextRequest } from 'next/server';
import { syncWishlist } from '@/lib/sync/wishlist';
import { getEnrichedGames } from '@/lib/db/queries';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';
import { createSyncSSEResponse } from '@/lib/utils/sse';

/**
 * POST /api/steam/wishlist
 * Triggers a sync of the user's Steam wishlist.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  return createSyncSSEResponse(syncWishlist, 'Wishlist', request, userId);
}

/**
 * GET /api/steam/wishlist
 * Returns the user's wishlist from the local database.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { games, total } = getEnrichedGames({ view: 'wishlist' }, undefined, undefined, userId);
    return apiSuccess(games, { total });
  } catch (error) {
    console.error('[GET /api/steam/wishlist]', error);
    return apiError('Failed to fetch wishlist');
  }
}
