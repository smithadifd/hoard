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
 * Invisible client component that triggers a one-shot Steam-review playtime
 * sample on mount. Only rendered when steamPlaytimeMedian is null and we haven't
 * given up retrying. Mirrors {@link HltbAutoFetch}.
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
          // Only refresh if we actually got a median back.
          if ((body as { data?: { steamPlaytimeMedian: number | null } }).data?.steamPlaytimeMedian != null) {
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
