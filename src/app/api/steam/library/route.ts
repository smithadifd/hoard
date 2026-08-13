import { NextRequest } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { getEnrichedGames } from '@/lib/db/queries';
import { apiSuccess, apiError, withAuth } from '@/lib/utils/api';
import { createSyncSSEResponse } from '@/lib/utils/sse';

/**
 * POST /api/steam/library
 * Triggers a sync of the user's Steam library.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (userId) => {
    return createSyncSSEResponse(syncLibrary, 'Library', request, userId);
  });
}

/**
 * GET /api/steam/library
 * Returns the user's library from the local database.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (userId) => {
    try {
      const { games, total } = getEnrichedGames({ view: 'library' }, undefined, undefined, userId);
      return apiSuccess(games, { total });
    } catch (error) {
      console.error('[GET /api/steam/library]', error);
      return apiError('Failed to fetch library');
    }
  });
}
