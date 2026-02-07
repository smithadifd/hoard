'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef, useCallback, useState } from 'react';
import { GameFilters } from '@/components/filters/GameFilters';
import { PresetButtons } from './PresetButtons';
import { RandomPickModal } from './RandomPickModal';
import type { GameFilters as GameFiltersType } from '@/types';
import type { EnrichedGame } from '@/types';

interface BacklogFiltersProps {
  currentFilters: GameFiltersType;
  games: EnrichedGame[];
  availableGenres: string[];
}

function pickRandom(games: EnrichedGame[]): EnrichedGame | null {
  if (games.length === 0) return null;
  return games[Math.floor(Math.random() * games.length)];
}

export function BacklogFilters({ currentFilters, games, availableGenres }: BacklogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickedGame, setPickedGame] = useState<EnrichedGame | null>(null);

  const navigate = useCallback(
    (newFilters: GameFiltersType) => {
      const params = new URLSearchParams();
      if (newFilters.search) params.set('search', newFilters.search);
      if (newFilters.sortBy && newFilters.sortBy !== 'title') params.set('sortBy', newFilters.sortBy);
      if (newFilters.sortOrder && newFilters.sortOrder !== 'asc') params.set('sortOrder', newFilters.sortOrder);
      if (newFilters.maxHours) params.set('maxHours', String(newFilters.maxHours));
      if (newFilters.minHours) params.set('minHours', String(newFilters.minHours));
      if (newFilters.coop !== undefined) params.set('coop', String(newFilters.coop));
      if (newFilters.onSale !== undefined) params.set('onSale', String(newFilters.onSale));
      if (newFilters.playtimeStatus) params.set('playtime', newFilters.playtimeStatus);
      if (newFilters.genres?.length) params.set('genres', newFilters.genres.join(','));
      if (newFilters.minReview) params.set('minReview', String(newFilters.minReview));

      const qs = params.toString();
      router.push(`${pathname}${qs ? '?' + qs : ''}`);
    },
    [router, pathname]
  );

  const handleFiltersChange = useCallback(
    (newFilters: GameFiltersType) => {
      const isSearchChange = newFilters.search !== currentFilters.search;

      if (isSearchChange) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => navigate(newFilters), 500);
      } else {
        navigate(newFilters);
      }
    },
    [navigate, currentFilters.search]
  );

  const handlePresetSelect = useCallback(
    (filters: GameFiltersType) => {
      navigate(filters);
    },
    [navigate]
  );

  const handleRandomPick = useCallback(() => {
    if (games.length === 0) return;
    setPickedGame(pickRandom(games));
    setModalOpen(true);
  }, [games]);

  const handleReroll = useCallback(() => {
    setPickedGame(pickRandom(games));
  }, [games]);

  return (
    <div className="space-y-4">
      <PresetButtons currentFilters={currentFilters} onPresetSelect={handlePresetSelect} />
      <GameFilters
        filters={currentFilters}
        onFiltersChange={handleFiltersChange}
        onRandomPick={handleRandomPick}
        showRandomPick={true}
        availableGenres={availableGenres}
      />
      <RandomPickModal
        picked={pickedGame}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onReroll={handleReroll}
      />
    </div>
  );
}
