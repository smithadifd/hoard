'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface EnsurePriceHistoryProps {
  gameId: number;
}

/**
 * Invisible client component that triggers a one-shot, idempotent price-history
 * backfill on mount (resolve ITAD link → pull full history). Rendered only when the
 * game is eligible (never backfilled, miss-count under the give-up threshold), so the
 * server route's guards plus this guarded mount keep it to one real fetch per game.
 * Refreshes the page when snapshots were actually inserted, so the chart appears.
 */
export function EnsurePriceHistory({ gameId }: EnsurePriceHistoryProps) {
  const router = useRouter();
  const firedRef = useRef<boolean>(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    async function run() {
      try {
        const res = await fetch(`/api/games/${gameId}/prices/ensure-history`, {
          method: 'POST',
        });
        if (!res.ok) return;
        const body = await res.json();
        if ((body as { data?: { status?: string } }).data?.status === 'backfilled') {
          router.refresh();
        }
      } catch {
        // Best-effort — price history is a gut-check nicety, not load-bearing.
      }
    }

    void run();
  }, [gameId, router]);

  return null;
}
