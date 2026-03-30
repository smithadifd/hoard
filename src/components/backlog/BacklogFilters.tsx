'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useRef, useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { GameFilters } from '@/components/filters/GameFilters';
import { PresetButtons } from './PresetButtons';
import { PickForMePanel, weightedPick } from './PickForMePanel';
import { RandomPickModal } from './RandomPickModal';
import type { GameFilters as GameFiltersType } from '@/types';
import type { EnrichedGame } from '@/types';

interface BacklogFiltersProps {
  currentFilters: GameFiltersType;
  games: EnrichedGame[];
  availableGenres: string[];
  presetCounts?: Record<string, number>;
  hiddenByStrictCount?: number;
}

export function BacklogFilters({ currentFilters, games, availableGenres, presetCounts, hiddenByStrictCount = 0 }: BacklogFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickedGame, setPickedGame] = useState<EnrichedGame | null>(null);
  const [candidates, setCandidates] = useState<EnrichedGame[]>([]);

  const navigate = useCallback(
    (newFilters: GameFiltersType) => {
      const params = new URLSearchParams();
      if (newFilters.search) params.set('search', newFilters.search);
      if (newFilters.sortBy && newFilters.sortBy !== 'title') params.set('sortBy', newFilters.sortBy);
      if (newFilters.sortOrder && newFilters.sortOrder !== 'asc') params.set('sortOrder', newFilters.sortOrder);
      if (newFilters.maxHours !== undefined) params.set('maxHours', String(newFilters.maxHours));
      if (newFilters.minHours !== undefined) params.set('minHours', String(newFilters.minHours));
      if (newFilters.coop !== undefined) params.set('coop', String(newFilters.coop));
      if (newFilters.onSale !== undefined) params.set('onSale', String(newFilters.onSale));
      if (newFilters.playtimeStatus) params.set('playtime', newFilters.playtimeStatus);
      if (newFilters.genres?.length) params.set('genres', newFilters.genres.join(','));
      if (newFilters.minReview !== undefined) params.set('minReview', String(newFilters.minReview));
      if (newFilters.minInterest !== undefined) params.set('minInterest', String(newFilters.minInterest));
      if (newFilters.strictFilters === false) params.set('showMissing', 'true');

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

  const handlePick = useCallback((pick: EnrichedGame, pool: EnrichedGame[]) => {
    setPickedGame(pick);
    setCandidates(pool);
    setModalOpen(true);
  }, []);

  const handleReroll = useCallback(() => {
    if (candidates.length === 0) return;
    const newPick = weightedPick(candidates);
    setPickedGame(newPick);
  }, [candidates]);

  return (
    <div className="space-y-4">
      <PresetButtons
        currentFilters={currentFilters}
        onPresetSelect={handlePresetSelect}
        presetCounts={presetCounts}
      />
      <GameFilters
        filters={currentFilters}
        onFiltersChange={handleFiltersChange}
        availableGenres={availableGenres}
        hidePricing={true}
      />
      {hiddenByStrictCount > 0 && currentFilters.strictFilters && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 text-amber-400 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{hiddenByStrictCount} game{hiddenByStrictCount !== 1 ? 's' : ''} hidden (missing duration/review data)</span>
          <button
            onClick={() => navigate({ ...currentFilters, strictFilters: false })}
            className="ml-auto text-xs font-medium underline underline-offset-2 hover:text-amber-300 whitespace-nowrap"
          >
            Show all
          </button>
        </div>
      )}
      {!currentFilters.strictFilters && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-muted-foreground text-sm">
          <span>Showing games with missing data</span>
          <button
            onClick={() => navigate({ ...currentFilters, strictFilters: true })}
            className="ml-auto text-xs font-medium underline underline-offset-2 hover:text-foreground whitespace-nowrap"
          >
            Hide incomplete
          </button>
        </div>
      )}
      <PickForMePanel games={games} onPick={handlePick} />
      <RandomPickModal
        finalPick={pickedGame}
        candidates={candidates}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onReroll={handleReroll}
      />
    </div>
  );
}
