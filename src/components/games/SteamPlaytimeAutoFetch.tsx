'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface SteamPlaytimeAutoFetchProps {
  gameId: number;
  /**
   * Refresh the route on success to render the new median. Defaults to true (the
   * game detail page wants this). Set false in flows like triage where a refresh
   * would yank the user's position — the value is still cached for next load and
   * the $/hour basis falls back to it immediately.
   */
  refreshOnSuccess?: boolean;
}

/**
 * Invisible client component that asks for a Steam-review playtime sample on
 * mount. Always safe to mount: the route decides whether a sample is due and is
 * a cheap no-op otherwise. Mirrors {@link HltbAutoFetch}.
 */
export function SteamPlaytimeAutoFetch({ gameId, refreshOnSuccess = true }: SteamPlaytimeAutoFetchProps) {
  const router = useRouter();
  const fetchedRef = useRef<boolean>(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function doFetch() {
      try {
        const res = await fetch(`/api/games/${gameId}/steam-playtime-fetch`, { method: 'POST' });
        if (res.ok && refreshOnSuccess) {
          const body = await res.json();
          // Only re-render when a new median actually landed.
          if ((body as { data?: { refreshed?: boolean } }).data?.refreshed === true) {
            router.refresh();
          }
        }
      } catch {
        // Silently fail — the estimate is best-effort.
      }
    }

    void doFetch();
  }, [gameId, router, refreshOnSuccess]);

  return null;
}
