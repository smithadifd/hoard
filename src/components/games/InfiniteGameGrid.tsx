'use client';

import { useCallback } from 'react';
import type { EnrichedGame, GameFilters } from '@/types';
import type { GameDetailOrigin } from '@/lib/utils/backNav';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { GameCard } from './GameCard';
import { GameGridSkeleton } from './GameGridSkeleton';

interface InfiniteGameGridProps {
  initialGames: EnrichedGame[];
  initialTotal: number;
  filters: GameFilters;
  pageSize?: number;
  emptyMessage?: string;
  /** Origin list — propagated to each card's detail link for back-navigation. */
  from?: GameDetailOrigin;
}

export function InfiniteGameGrid({
  initialGames,
  initialTotal,
  filters,
  pageSize = 24,
  emptyMessage = 'No games found',
  from,
}: InfiniteGameGridProps) {
  useScrollRestoration();

  const buildUrl = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (filters.view) params.set('view', filters.view);
      if (filters.search) params.set('search', filters.search);
      if (filters.sortBy) params.set('sortBy', filters.sortBy);
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
      if (filters.playtimeStatus) params.set('playtimeStatus', filters.playtimeStatus);
      if (filters.maxHours !== undefined) params.set('maxHours', String(filters.maxHours));
      if (filters.minHours !== undefined) params.set('minHours', String(filters.minHours));
      if (filters.coop !== undefined) params.set('coop', String(filters.coop));
      if (filters.onSale !== undefined) params.set('onSale', String(filters.onSale));
      if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
      if (filters.minReview !== undefined) params.set('minReview', String(filters.minReview));
      if (filters.maxReviewCount !== undefined) params.set('maxReviewCount', String(filters.maxReviewCount));
      if (filters.minInterest !== undefined) params.set('minInterest', String(filters.minInterest));
      if (filters.rated !== undefined) params.set('rated', String(filters.rated));
      if (filters.valueReceivedTier) params.set('valueReceivedTier', filters.valueReceivedTier);
      if (filters.strictFilters !== undefined) params.set('strictFilters', String(filters.strictFilters));
      if (filters.requireCompleteData !== undefined) params.set('requireCompleteData', String(filters.requireCompleteData));
      if (filters.hideUnreleased !== undefined) params.set('hideUnreleased', String(filters.hideUnreleased));
      if (filters.genres?.length) params.set('genres', filters.genres.join(','));
      if (filters.excludeTags?.length) params.set('excludeTags', filters.excludeTags.join(','));
      if (filters.daysBack !== undefined) params.set('daysBack', String(filters.daysBack));
      return `/api/games?${params.toString()}`;
    },
    [filters, pageSize],
  );

  const { games, total, isLoading, hasMore, sentinelRef } = useInfiniteScroll({
    initialGames,
    initialTotal,
    buildUrl,
  });

  if (games.length === 0 && !isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] p-12 text-center text-muted-foreground">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {games.map((game) => (
          <GameCard key={game.id} game={game} from={from} />
        ))}
      </div>

      {/* Showing count */}
      {total > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {games.length} of {total}
        </p>
      )}

      {/* Loading skeleton for next page */}
      {isLoading && <GameGridSkeleton count={Math.min(pageSize, 8)} />}

      {/* Sentinel — IntersectionObserver attaches here */}
      {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden />}
    </div>
  );
}
