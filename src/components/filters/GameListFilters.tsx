'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef, useCallback } from 'react';
import { GameFilters } from './GameFilters';
import type { GameFilters as GameFiltersType } from '@/types';

interface GameListFiltersProps {
  currentFilters: GameFiltersType;
}

export function GameListFilters({ currentFilters }: GameListFiltersProps) {
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
      if (newFilters.requireCompleteData === false) params.set('showAll', 'true');
      if (newFilters.hideUnreleased === false) params.set('showUnreleased', 'true');

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

  return <GameFilters filters={currentFilters} onFiltersChange={handleFiltersChange} />;
}
