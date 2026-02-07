'use client';

import { useState } from 'react';
import { Search, SlidersHorizontal, Shuffle, X, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import type { GameFilters as GameFiltersType } from '@/types';

interface GameFiltersProps {
  filters: GameFiltersType;
  onFiltersChange: (filters: GameFiltersType) => void;
  onRandomPick?: () => void;
  showRandomPick?: boolean;
}

/**
 * GameFilters - Filter and sort controls for game lists.
 *
 * Features:
 * - Text search
 * - Duration range (for backlog browsing)
 * - Genre/tag filters
 * - Co-op filter
 * - Sort options
 * - "Pick for me" random button
 */
export function GameFilters({
  filters,
  onFiltersChange,
  onRandomPick,
  showRandomPick = false,
}: GameFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateFilter = <K extends keyof GameFiltersType>(
    key: K,
    value: GameFiltersType[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-3">
      {/* Search + Quick Actions */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search games..."
            value={filters.search || ''}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {filters.search && (
            <button
              onClick={() => updateFilter('search', '')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
            showAdvanced
              ? 'bg-secondary text-secondary-foreground border-border'
              : 'border-input text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>

        {showRandomPick && onRandomPick && (
          <button
            onClick={onRandomPick}
            className="px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors flex items-center gap-2"
          >
            <Shuffle className="h-4 w-4" />
            Pick for me
          </button>
        )}
      </div>

      {/* Advanced Filters (collapsible) */}
      {showAdvanced && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-lg border border-border bg-card">
          {/* Duration */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Max Duration</label>
            <select
              value={filters.maxHours || ''}
              onChange={(e) => updateFilter('maxHours', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="5">Under 5 hours</option>
              <option value="10">Under 10 hours</option>
              <option value="20">Under 20 hours</option>
              <option value="40">Under 40 hours</option>
              <option value="100">Under 100 hours</option>
            </select>
          </div>

          {/* Co-op */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Co-op</label>
            <select
              value={filters.coop === undefined ? '' : filters.coop ? 'yes' : 'no'}
              onChange={(e) => updateFilter('coop', e.target.value === '' ? undefined : e.target.value === 'yes')}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="yes">Co-op only</option>
              <option value="no">Single player only</option>
            </select>
          </div>

          {/* On Sale */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Pricing</label>
            <select
              value={filters.onSale === undefined ? '' : filters.onSale ? 'yes' : 'no'}
              onChange={(e) => updateFilter('onSale', e.target.value === '' ? undefined : e.target.value === 'yes')}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="yes">On sale</option>
            </select>
          </div>

          {/* Sort */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sort By</label>
            <div className="flex gap-1">
              <select
                value={filters.sortBy || 'title'}
                onChange={(e) => updateFilter('sortBy', e.target.value as GameFiltersType['sortBy'])}
                className="min-w-0 flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="title">Title</option>
                <option value="dealScore">Deal Score</option>
                <option value="price">Price</option>
                <option value="review">Review Score</option>
                <option value="hltbMain">Duration</option>
                <option value="playtime">Playtime</option>
                <option value="releaseDate">Release Date</option>
              </select>
              <button
                onClick={() => updateFilter('sortOrder', filters.sortOrder === 'desc' ? 'asc' : 'desc')}
                className="shrink-0 px-2 py-1.5 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground transition-colors"
                title={filters.sortOrder === 'desc' ? 'Descending' : 'Ascending'}
              >
                {filters.sortOrder === 'desc' ? (
                  <ArrowDownNarrowWide className="h-4 w-4" />
                ) : (
                  <ArrowUpNarrowWide className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
