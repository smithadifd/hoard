'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, SlidersHorizontal, Shuffle, X, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import type { GameFilters as GameFiltersType } from '@/types';

interface GameFiltersProps {
  filters: GameFiltersType;
  onFiltersChange: (filters: GameFiltersType) => void;
  onRandomPick?: () => void;
  showRandomPick?: boolean;
  availableGenres?: string[];
  hidePricing?: boolean;
}

export function GameFilters({
  filters,
  onFiltersChange,
  onRandomPick,
  showRandomPick = false,
  availableGenres,
  hidePricing = false,
}: GameFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const [genreSearch, setGenreSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const genreRef = useRef<HTMLDivElement>(null);

  const updateFilter = <K extends keyof GameFiltersType>(
    key: K,
    value: GameFiltersType[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  // Close genre dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (genreRef.current && !genreRef.current.contains(e.target as Node)) {
        setGenreDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleGenre = (genre: string) => {
    const current = filters.genres || [];
    const next = current.includes(genre)
      ? current.filter((g) => g !== genre)
      : [...current, genre];
    updateFilter('genres', next.length > 0 ? next : undefined);
  };

  const filteredGenres = availableGenres?.filter((g) =>
    g.toLowerCase().includes(genreSearch.toLowerCase())
  ) ?? [];

  // Count active advanced filters for indicator (exclude defaults that are ON by default)
  const advancedFilterCount = [
    filters.maxHours,
    filters.minHours,
    filters.coop !== undefined ? true : undefined,
    filters.onSale,
    filters.playtimeStatus,
    filters.genres?.length ? true : undefined,
    filters.minReview,
    filters.requireCompleteData === false ? true : undefined,
    filters.hideUnreleased === false ? true : undefined,
  ].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Search + Quick Actions */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search games..."
            defaultValue={filters.search || ''}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {filters.search && (
            <button
              onClick={() => {
                if (searchInputRef.current) searchInputRef.current.value = '';
                updateFilter('search', '');
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`relative px-3 py-2 rounded-md border text-sm font-medium transition-colors min-h-[44px] flex items-center justify-center ${
            showAdvanced
              ? 'bg-secondary text-secondary-foreground border-border'
              : 'border-input text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {advancedFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
              {advancedFilterCount}
            </span>
          )}
        </button>

        {showRandomPick && onRandomPick && (
          <button
            onClick={onRandomPick}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 min-h-[44px]"
          >
            <Shuffle className="h-4 w-4" />
            Pick for me
          </button>
        )}
      </div>

      {/* Advanced Filters (collapsible) */}
      {showAdvanced && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-xl bg-card">
          {/* Duration */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Max Duration</label>
            <select
              value={filters.maxHours || ''}
              onChange={(e) => updateFilter('maxHours', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
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
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="yes">Co-op only</option>
              <option value="no">Single player only</option>
            </select>
          </div>

          {/* Playtime Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Play Status</label>
            <select
              value={filters.playtimeStatus || ''}
              onChange={(e) => updateFilter('playtimeStatus', e.target.value ? e.target.value as GameFiltersType['playtimeStatus'] : undefined)}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="backlog">Backlog</option>
              <option value="unplayed">Unplayed</option>
              <option value="underplayed">Under 1 hour</option>
            </select>
          </div>

          {/* Min Review */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Min Review</label>
            <select
              value={filters.minReview || ''}
              onChange={(e) => updateFilter('minReview', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="70">70%+</option>
              <option value="80">80%+</option>
              <option value="85">85%+</option>
              <option value="90">90%+</option>
            </select>
          </div>

          {/* On Sale */}
          {!hidePricing && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Pricing</label>
              <select
                value={filters.onSale === undefined ? '' : filters.onSale ? 'yes' : 'no'}
                onChange={(e) => updateFilter('onSale', e.target.value === '' ? undefined : e.target.value === 'yes')}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="">Any</option>
                <option value="yes">On sale</option>
              </select>
            </div>
          )}

          {/* Data Completeness */}
          {filters.requireCompleteData !== undefined && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Data Quality</label>
              <select
                value={filters.requireCompleteData ? 'complete' : 'all'}
                onChange={(e) => updateFilter('requireCompleteData', e.target.value === 'complete')}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="complete">Complete data only</option>
                <option value="all">Show all</option>
              </select>
            </div>
          )}

          {/* Unreleased */}
          {filters.hideUnreleased !== undefined && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Release Status</label>
              <select
                value={filters.hideUnreleased ? 'released' : 'all'}
                onChange={(e) => updateFilter('hideUnreleased', e.target.value === 'released')}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="released">Released only</option>
                <option value="all">Include unreleased</option>
              </select>
            </div>
          )}

          {/* Genre Multi-Select */}
          {availableGenres && availableGenres.length > 0 && (
            <div className="space-y-1 relative col-span-2" ref={genreRef}>
              <label className="text-xs font-medium text-muted-foreground">Genres</label>
              <button
                onClick={() => setGenreDropdownOpen(!genreDropdownOpen)}
                className="w-full px-2 py-1.5 rounded-md bg-background border border-input text-sm text-left truncate"
              >
                {filters.genres?.length
                  ? filters.genres.join(', ')
                  : 'All genres'}
              </button>
              {genreDropdownOpen && (
                <div className="absolute z-20 top-full mt-1 w-full bg-card border border-white/[0.08] rounded-md shadow-lg max-h-60 overflow-hidden">
                  <div className="p-2 border-b border-white/[0.06]">
                    <input
                      type="text"
                      placeholder="Search genres..."
                      value={genreSearch}
                      onChange={(e) => setGenreSearch(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto max-h-44 p-1">
                    {filteredGenres.map((genre) => (
                      <label
                        key={genre}
                        className="flex items-center gap-2 px-3 py-2 rounded hover:bg-secondary cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={filters.genres?.includes(genre) ?? false}
                          onChange={() => toggleGenre(genre)}
                          className="rounded border-input"
                        />
                        {genre}
                      </label>
                    ))}
                    {filteredGenres.length === 0 && (
                      <div className="px-2 py-1 text-sm text-muted-foreground">No genres found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sort */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sort By</label>
            <div className="flex gap-1">
              <select
                value={filters.sortBy || 'title'}
                onChange={(e) => updateFilter('sortBy', e.target.value as GameFiltersType['sortBy'])}
                className="min-w-0 flex-1 px-2 py-2.5 rounded-md bg-background border border-input text-sm"
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
                className="shrink-0 px-3 py-2.5 rounded-md border border-input bg-background text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
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

          {/* Clear Filters */}
          {advancedFilterCount > 0 && (
            <div className="flex items-end">
              <button
                onClick={() => {
                  if (searchInputRef.current) searchInputRef.current.value = '';
                  onFiltersChange({
                    ...filters,
                    search: undefined,
                    maxHours: undefined,
                    minHours: undefined,
                    coop: undefined,
                    onSale: undefined,
                    playtimeStatus: undefined,
                    genres: undefined,
                    minReview: undefined,
                    requireCompleteData: filters.requireCompleteData !== undefined ? true : undefined,
                    hideUnreleased: filters.hideUnreleased !== undefined ? true : undefined,
                    sortBy: 'title',
                    sortOrder: 'asc',
                  });
                }}
                className="px-3 py-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground border border-input hover:border-border transition-colors min-h-[44px]"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active genre chips */}
      {filters.genres && filters.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.genres.map((genre) => (
            <span
              key={genre}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs"
            >
              {genre}
              <button
                onClick={() => toggleGenre(genre)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
