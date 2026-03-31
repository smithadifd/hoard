'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { EnrichedGame } from '@/types';

interface UseInfiniteScrollOptions {
  initialGames: EnrichedGame[];
  initialTotal: number;
  /** Called with the next page number; return the full URL to fetch */
  buildUrl: (page: number) => string;
}

interface UseInfiniteScrollResult {
  games: EnrichedGame[];
  total: number;
  isLoading: boolean;
  hasMore: boolean;
  /** Attach to a sentinel div at the bottom of the list */
  sentinelRef: React.RefCallback<HTMLDivElement>;
}

export function useInfiniteScroll({
  initialGames,
  initialTotal,
  buildUrl,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const [games, setGames] = useState<EnrichedGame[]>(initialGames);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const pageRef = useRef(1);
  const isFetchingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const gamesLengthRef = useRef(initialGames.length);
  const totalRef = useRef(initialTotal);

  const hasMore = games.length < total;

  // Keep refs in sync with state
  gamesLengthRef.current = games.length;
  totalRef.current = total;

  // Reset when initialGames changes (filter change causes server re-render)
  useEffect(() => {
    setGames(initialGames);
    setTotal(initialTotal);
    pageRef.current = 1;
    gamesLengthRef.current = initialGames.length;
    totalRef.current = initialTotal;
  }, [initialGames, initialTotal]);

  const fetchNextPage = useCallback(async () => {
    if (isFetchingRef.current || gamesLengthRef.current >= totalRef.current) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    const nextPage = pageRef.current + 1;
    try {
      const res = await fetch(buildUrl(nextPage));
      if (!res.ok) return;
      const json = await res.json();
      const newGames = json.data as EnrichedGame[];
      setGames((prev) => {
        const updated = [...prev, ...newGames];
        gamesLengthRef.current = updated.length;
        return updated;
      });
      setTotal((prevTotal) => {
        const newTotal = json.meta?.total ?? prevTotal;
        totalRef.current = newTotal;
        return newTotal;
      });
      pageRef.current = nextPage;
    } catch {
      // Non-critical: user can scroll up slightly to re-trigger
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [buildUrl]);

  const sentinelRef: React.RefCallback<HTMLDivElement> = useCallback(
    (node) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            void fetchNextPage();
          }
        },
        { rootMargin: '200px' },
      );
      observerRef.current.observe(node);
    },
    [fetchNextPage],
  );

  return { games, total, isLoading, hasMore, sentinelRef };
}
