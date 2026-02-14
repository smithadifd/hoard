import { NextRequest } from 'next/server';
import { syncLibrary } from '@/lib/sync/library';
import { getEnrichedGames } from '@/lib/db/queries';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';

/**
 * POST /api/steam/library
 * Triggers a sync of the user's Steam library.
 * Streams progress via SSE (text/event-stream).
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();

  request.signal.addEventListener('abort', () => {
    abortController.abort();
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed
        }
      };

      try {
        const result = await syncLibrary((processed, total, context) => {
          send('progress', { processed, total, ...context });
        }, abortController.signal, userId);
        send('done', { gamesProcessed: result.gamesProcessed, cancelled: abortController.signal.aborted });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Library sync failed';
        console.error('[POST /api/steam/library] Library sync failed:', error);
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
 * GET /api/steam/library
 * Returns the user's library from the local database.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { games, total } = getEnrichedGames({ view: 'library' }, undefined, undefined, userId);
    return apiSuccess(games, { total });
  } catch (error) {
    console.error('[GET /api/steam/library]', error);
    return apiError('Failed to fetch library');
  }
}
