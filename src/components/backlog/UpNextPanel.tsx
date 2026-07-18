'use client';

/**
 * "Up Next" — small client panel that consumes the already-shipped
 * `GET /api/backlog/recommendations` route (backlog-v2, Queue S S9) and
 * surfaces its 3-5 item queue on the backlog page: one bucket badge
 * (Continue / Finish Soon / Start Fresh / Drop) and one concrete reason per
 * pick. UI only — no bucketing/ranking logic lives here, it's all upstream in
 * `src/lib/backlog/{upNext,ranking}.ts`.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { UpNextBucket } from '@/lib/backlog/upNext';

export interface UpNextItem {
  gameId: number;
  title: string;
  bucket: UpNextBucket;
  reason: string;
  score: number;
}

/** Badge background, keyed by bucket — mirrors the DealIndicator/ValueReceivedIndicator
 *  convention (categorical enum -> solid color chip, white text, `/N` for a muted variant). */
export const UP_NEXT_BUCKET_BG: Record<UpNextBucket, string> = {
  continue: 'bg-deal-great',
  'finish-soon': 'bg-deal-good',
  'start-fresh': 'bg-primary',
  drop: 'bg-deal-poor/80',
};

export const UP_NEXT_BUCKET_LABEL: Record<UpNextBucket, string> = {
  continue: 'Continue',
  'finish-soon': 'Finish Soon',
  'start-fresh': 'Start Fresh',
  drop: 'Drop',
};

/**
 * Narrow + validate the `/api/backlog/recommendations` GET response shape
 * (`{ data: { queue: UpNextItem[] } }`, the `ApiResponse<T>` convention) so a
 * malformed or unexpected payload surfaces as an error rather than a silent
 * empty render. Exported for direct unit testing without mounting the DOM.
 */
export function parseUpNextQueueResponse(body: unknown): UpNextItem[] {
  const data = (body as { data?: unknown } | null | undefined)?.data;
  const queue = (data as { queue?: unknown } | null | undefined)?.queue;
  if (!Array.isArray(queue)) {
    throw new Error('Malformed Up Next response');
  }
  return queue as UpNextItem[];
}

/**
 * Fetch + parse the queue from the shipped route. Exported (module-level, not
 * a closure inside the component) so tests can stub `global.fetch` and
 * exercise the success/empty/error paths directly.
 */
export async function fetchUpNextQueue(): Promise<UpNextItem[]> {
  const res = await fetch('/api/backlog/recommendations');
  if (!res.ok) {
    throw new Error(`Up Next request failed (${res.status})`);
  }
  const body = await res.json();
  return parseUpNextQueueResponse(body);
}

type LoadState = 'loading' | 'error' | 'ready';

export function UpNextPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<UpNextItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchUpNextQueue()
      .then((queue) => {
        if (cancelled) return;
        setItems(queue);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-headline font-bold">Up Next</h2>
      </div>

      {state === 'loading' && (
        <div className="space-y-2" aria-label="Loading Up Next picks">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-md bg-secondary/50 animate-pulse" />
          ))}
        </div>
      )}

      {state === 'error' && (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your Up Next picks right now.</p>
      )}

      {state === 'ready' && items.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          No picks yet — rate a few more games and Up Next will start surfacing your next play.
        </p>
      )}

      {state === 'ready' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.gameId}>
              <Link
                href={`/games/${item.gameId}`}
                className="flex items-center justify-between gap-3 rounded-md p-2 -m-2 hover:bg-secondary/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.reason}</p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded text-xs font-label font-bold text-white ${UP_NEXT_BUCKET_BG[item.bucket]}`}
                >
                  {UP_NEXT_BUCKET_LABEL[item.bucket]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
