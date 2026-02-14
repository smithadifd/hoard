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
