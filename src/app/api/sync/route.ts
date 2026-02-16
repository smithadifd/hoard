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
import type { SyncResult, ProgressCallback } from '@/lib/sync/types';

type SyncFn = (
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  userId?: string
) => Promise<SyncResult>;

/**
 * Helper: wrap a sync function with SSE progress streaming.
 * Supports cancellation via AbortController when the client disconnects.
 */
function streamSync(syncFn: SyncFn, label: string, request: NextRequest, userId: string) {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // Abort the sync if the client disconnects
  request.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed (client disconnected)
        }
      };

      try {
        const result = await syncFn((processed, total, context) => {
          send('progress', { processed, total, ...context });
        }, abortController.signal, userId);

        if (abortController.signal.aborted) {
          send('done', { gamesProcessed: result.stats.succeeded, cancelled: true });
        } else {
          send('done', { gamesProcessed: result.stats.succeeded, message: result.message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `${label} sync failed`;
        console.error(`[POST /api/sync] ${label} sync failed:`, error);
        send('error', { error: message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

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
        return streamSync(syncLibrary, 'Library', request, userId);
      case 'wishlist':
        return streamSync(syncWishlist, 'Wishlist', request, userId);
      case 'prices':
        return streamSync(syncPrices, 'Price', request, userId);
      case 'hltb':
        return streamSync(syncHltb, 'HLTB', request, userId);
      case 'reviews':
        return streamSync(syncReviews, 'Review', request, userId);
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
