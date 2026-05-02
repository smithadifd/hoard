'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface HltbAutoFetchProps {
  gameId: number;
}

/**
 * Invisible client component that triggers a one-shot HLTB fetch on mount.
 * Only rendered in lookup mode when hltbMain is null.
 * On success, calls router.refresh() to re-render the page with HLTB data.
 */
export function HltbAutoFetch({ gameId }: HltbAutoFetchProps) {
  const router = useRouter();
  const fetchedRef = useRef<boolean>(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function doFetch() {
      try {
        const res = await fetch(`/api/games/${gameId}/hltb-fetch`, { method: 'POST' });
        if (res.ok) {
          const body = await res.json();
          // Only refresh if we got actual data back
          if ((body as { data?: { hltbMain: number | null } }).data?.hltbMain !== null) {
            router.refresh();
          }
        }
      } catch {
        // Silently fail — HLTB is best-effort
      }
    }

    void doFetch();
  }, [gameId, router]);

  return null;
}
