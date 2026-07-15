'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef, useCallback } from 'react';
import { GameFilters, LIBRARY_SORT_OPTIONS } from './GameFilters';
import { LibraryValueFilters } from './LibraryValueFilters';
import type { GameFilters as GameFiltersType } from '@/types';

interface GameListFiltersProps {
  currentFilters: GameFiltersType;
  /** Library-only: render the Value Received filter row (rated/unrated, tier, realized $/hr). */
  showValueFilters?: boolean;
}

export function GameListFilters({ currentFilters, showValueFilters = false }: GameListFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const navigate = useCallback(
    (newFilters: GameFiltersType) => {
      const params = new URLSearchParams();
      if (newFilters.search) params.set('search', newFilters.search);
      if (newFilters.sortBy) params.set('sortBy', newFilters.sortBy);
      if (newFilters.sortOrder) params.set('sortOrder', newFilters.sortOrder);
      if (newFilters.maxHours !== undefined) params.set('maxHours', String(newFilters.maxHours));
      if (newFilters.coop !== undefined) params.set('coop', String(newFilters.coop));
      if (newFilters.maxPrice !== undefined) params.set('maxPrice', String(newFilters.maxPrice));
      if (newFilters.onSale !== undefined) params.set('onSale', String(newFilters.onSale));
      if (newFilters.playtimeStatus) params.set('playtime', newFilters.playtimeStatus);
      if (newFilters.genres?.length) params.set('genres', newFilters.genres.join(','));
      if (newFilters.minReview !== undefined) params.set('minReview', String(newFilters.minReview));
      if (newFilters.minInterest !== undefined) params.set('minInterest', String(newFilters.minInterest));
      if (newFilters.rated !== undefined) params.set('rated', String(newFilters.rated));
      if (newFilters.valueReceivedTier) params.set('valueReceivedTier', newFilters.valueReceivedTier);
      if (newFilters.requireCompleteData === false) params.set('showAll', 'true');
      if (newFilters.hideUnreleased === false) params.set('showUnreleased', 'true');
      if (newFilters.earlyAccess !== undefined) params.set('earlyAccess', String(newFilters.earlyAccess));

      const qs = params.toString();
      router.push(`${pathname}${qs ? '?' + qs : ''}`);
    },
    [router, pathname]
  );

  const handleFiltersChange = useCallback(
    (newFilters: GameFiltersType) => {
      // Debounce search input, immediate for other filters
      const isSearchChange = newFilters.search !== currentFilters.search;

      if (isSearchChange) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => navigate(newFilters), 300);
      } else {
        navigate(newFilters);
      }
    },
    [navigate, currentFilters.search]
  );

  return (
    <div className="space-y-3">
      {showValueFilters && (
        <LibraryValueFilters filters={currentFilters} onChange={handleFiltersChange} />
      )}
      <GameFilters filters={currentFilters} onFiltersChange={handleFiltersChange} sortOptions={LIBRARY_SORT_OPTIONS} />
    </div>
  );
}
