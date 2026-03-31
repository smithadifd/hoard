import { NextRequest } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { syncWishlist } from '@/lib/sync/wishlist';
import { syncPrices } from '@/lib/sync/prices';
import { syncHltb } from '@/lib/sync/hltb';
import { syncReviews } from '@/lib/sync/reviews';
import { getRecentSyncLogs } from '@/lib/db/queries';
import { getTaskStatus } from '@/lib/scheduler';
import { syncTriggerSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { createSyncSSEResponse } from '@/lib/utils/sse';

/**
 * POST /api/sync
 * Trigger a manual sync operation.
 * Body: { type: 'library' | 'wishlist' | 'prices' | 'hltb' }
 * Returns SSE stream with progress events.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json();
    const parsed = syncTriggerSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    switch (parsed.data.type) {
      case 'library':
        return createSyncSSEResponse(syncLibrary, 'Library', request, userId);
      case 'wishlist':
        return createSyncSSEResponse(syncWishlist, 'Wishlist', request, userId);
      case 'prices':
        return createSyncSSEResponse(syncPrices, 'Price', request, userId);
      case 'hltb':
        return createSyncSSEResponse(syncHltb, 'HLTB', request, userId);
      case 'reviews':
        return createSyncSSEResponse(syncReviews, 'Review', request, userId);
    }
  } catch (error) {
    console.error('[POST /api/sync]', error);
    return apiError('Sync failed');
  }
}

/**
 * GET /api/sync
 * Get status of recent sync operations.
 */
export async function GET(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const logs = getRecentSyncLogs(20);
    const tasks = getTaskStatus();
    return apiSuccess({ logs, tasks });
  } catch (error) {
    console.error('[GET /api/sync]', error);
    return apiError('Failed to fetch sync status');
  }
}
