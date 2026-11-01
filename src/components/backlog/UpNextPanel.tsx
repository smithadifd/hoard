'use client';

/**
 * "Up Next" — small client panel that consumes the already-shipped
 * `GET /api/backlog/recommendations` route (backlog-v2, Queue S S9) and
 * surfaces its 3-5 item queue on the backlog page: one bucket badge
 * (Continue / Finish Soon / Start Fresh / Drop) and one concrete reason per
 * pick. UI only — no bucketing/ranking logic lives here, it's all upstream in
 * `src/lib/backlog/{upNext,ranking}.ts`.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import {
  type UpNextItem,
  UP_NEXT_BUCKET_BG,
  UP_NEXT_BUCKET_LABEL,
  fetchUpNextQueue,
  emitShownOnce,
  postRecommendationSignal,
  buildAcceptedSignal,
} from './upNextQueue';

type LoadState = 'loading' | 'error' | 'ready';

export function UpNextPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<UpNextItem[]>([]);
  // Tracks the queue key we've already emitted a `shown` signal for.
  const shownFiredRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUpNextQueue()
      .then((queue) => {
        if (cancelled) return;
        setItems(queue);
        setState('ready');
        // Best-effort: tell the learning ranker what we surfaced, exactly once
        // per distinct queue. `.catch` is belt-and-suspenders — emitShownOnce
        // already never rejects — so the display path can't be perturbed.
        void emitShownOnce(queue, shownFiredRef).catch(() => {});
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
                onClick={() => {
                  // Accepted signal fires alongside navigation (fire-and-forget,
                  // keepalive) — never preventDefault, never block the click.
                  void postRecommendationSignal(buildAcceptedSignal(item.gameId));
                }}
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
