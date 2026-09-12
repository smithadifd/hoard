'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface EnsurePriceHistoryProps {
  gameId: number;
}

/**
 * Invisible client component that triggers the idempotent price-history self-heal
 * on mount (resolve ITAD link → pull full history). Fires at most once per mount;
 * the server route decides whether a pull is actually due (never backfilled, or
 * stamped but the stored history falls short of launch and the retry cooldown has
 * lapsed) and answers with a cheap no-op otherwise.
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
