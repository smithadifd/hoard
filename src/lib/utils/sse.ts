import type { NextRequest } from 'next/server';
import type { SyncResult, ProgressCallback } from '@/lib/sync/types';

type SyncFn = (
  onProgress: ProgressCallback,
  signal?: AbortSignal,
  userId?: string
) => Promise<SyncResult>;

/**
 * Create an SSE Response that streams progress from a sync function.
 * Supports cancellation via AbortController when the client disconnects.
 */
export function createSyncSSEResponse(
  syncFn: SyncFn,
  label: string,
  request: NextRequest,
  userId: string
): Response {
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
        console.error(`[${label} Sync]`, error);
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

export interface SSEProgressEvent {
  type: 'progress';
  processed: number;
  total: number;
  gameName?: string;
  status?: string;
}

export interface SSEDoneEvent {
  type: 'done';
  gamesProcessed: number;
  cancelled?: boolean;
  message?: string;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
}

export type SSEEvent = SSEProgressEvent | SSEDoneEvent | SSEErrorEvent;

/**
 * Read an SSE stream from a fetch Response, calling handlers for each event type.
 */
export async function readSSEStream(
  response: Response,
  handlers: {
    onProgress: (data: SSEProgressEvent) => void;
    onDone: (gamesProcessed: number, cancelled?: boolean, message?: string) => void;
    onError: (message: string) => void;
  }
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE messages from buffer
    const messages = buffer.split('\n\n');
    buffer = messages.pop() ?? ''; // Keep incomplete message in buffer

    for (const msg of messages) {
      if (!msg.trim()) continue;

      let event = 'message';
      let data = '';
      for (const line of msg.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }

      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (event === 'progress') {
          handlers.onProgress({
            type: 'progress',
            processed: parsed.processed,
            total: parsed.total,
            gameName: parsed.gameName,
            status: parsed.status,
          });
        } else if (event === 'done') {
          handlers.onDone(parsed.gamesProcessed, parsed.cancelled, parsed.message);
        } else if (event === 'error') {
          handlers.onError(parsed.error);
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }
}
