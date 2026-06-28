'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, SlidersHorizontal, Shuffle, X, ArrowUpNarrowWide, ArrowDownNarrowWide } from 'lucide-react';
import type { GameFilters as GameFiltersType } from '@/types';

export type SortOption = { value: NonNullable<GameFiltersType['sortBy']>; label: string };

/** Sort options every game list shares. */
export const BASE_SORT_OPTIONS: SortOption[] = [
  { value: 'title', label: 'Title' },
  { value: 'dealScore', label: 'Deal Score' },
  { value: 'price', label: 'Price' },
  { value: 'review', label: 'Review Score' },
  { value: 'hltbMain', label: 'Duration' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'releaseDate', label: 'Release Date' },
];

/** Library adds the backward-looking Value Received sorts (owned games). */
export const LIBRARY_SORT_OPTIONS: SortOption[] = [
  ...BASE_SORT_OPTIONS,
  { value: 'valueReceived', label: 'Value Received' },
  { value: 'realizedDollarsPerHour', label: 'Realized $/hr' },
  { value: 'completionRatio', label: 'Completion %' },
  { value: 'pricePaid', label: 'Price Paid' },
];

/** Backlog (unplayed) — forward-looking value + spend; $/hr & completion are ~empty here. */
export const BACKLOG_SORT_OPTIONS: SortOption[] = [
  ...BASE_SORT_OPTIONS,
  { value: 'valueWaiting', label: 'Most Value Waiting' },
  { value: 'pricePaid', label: 'Price Paid' },
];

interface GameFiltersProps {
  filters: GameFiltersType;
  onFiltersChange: (filters: GameFiltersType) => void;
  onRandomPick?: () => void;
  showRandomPick?: boolean;
  availableGenres?: string[];
  hidePricing?: boolean;
  sortOptions?: SortOption[];
}

export function GameFilters({
  filters,
  onFiltersChange,
  onRandomPick,
  showRandomPick = false,
  availableGenres,
  hidePricing = false,
  sortOptions = BASE_SORT_OPTIONS,
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
    filters.maxPrice !== undefined ? true : undefined,
    filters.playtimeStatus,
    filters.genres?.length ? true : undefined,
    filters.minReview,
    filters.minInterest,
    filters.requireCompleteData === false ? true : undefined,
    filters.hideUnreleased === false ? true : undefined,
    filters.earlyAccess !== undefined ? true : undefined,
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
            aria-label="Search games"
            placeholder="Search games..."
            defaultValue={filters.search || ''}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {filters.search && (
            <button
              aria-label="Clear search"
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
          aria-label="Advanced filters"
          aria-expanded={showAdvanced}
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
            <label htmlFor="filter-max-hours" className="text-xs font-medium text-muted-foreground">Max Duration</label>
            <select
              id="filter-max-hours"
              value={filters.maxHours || ''}
              onChange={(e) => updateFilter('maxHours', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="1">Under 1 hour</option>
              <option value="2">Under 2 hours</option>
              <option value="5">Under 5 hours</option>
              <option value="10">Under 10 hours</option>
              <option value="20">Under 20 hours</option>
              <option value="40">Under 40 hours</option>
              <option value="100">Under 100 hours</option>
            </select>
          </div>

          {/* Co-op */}
          <div className="space-y-1">
            <label htmlFor="filter-coop" className="text-xs font-medium text-muted-foreground">Co-op</label>
            <select
              id="filter-coop"
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
            <label htmlFor="filter-play-status" className="text-xs font-medium text-muted-foreground">Play Status</label>
            <select
              id="filter-play-status"
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
            <label htmlFor="filter-min-review" className="text-xs font-medium text-muted-foreground">Min Review</label>
            <select
              id="filter-min-review"
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

          {/* Pricing */}
          {!hidePricing && (
            <div className="space-y-1">
              <label htmlFor="filter-pricing" className="text-xs font-medium text-muted-foreground">Pricing</label>
              <select
                id="filter-pricing"
                value={
                  filters.maxPrice !== undefined
                    ? `max:${filters.maxPrice}`
                    : filters.onSale ? 'sale' : ''
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    onFiltersChange({ ...filters, maxPrice: undefined, onSale: undefined });
                  } else if (val === 'sale') {
                    onFiltersChange({ ...filters, maxPrice: undefined, onSale: true });
                  } else if (val.startsWith('max:')) {
                    onFiltersChange({ ...filters, maxPrice: Number(val.slice(4)), onSale: undefined });
                  }
                }}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="">Any</option>
                <option value="max:0">Free</option>
                <option value="max:5">Under $5</option>
                <option value="max:10">Under $10</option>
                <option value="max:15">Under $15</option>
                <option value="max:20">Under $20</option>
                <option value="max:30">Under $30</option>
                <option value="sale">On sale</option>
              </select>
            </div>
          )}

          {/* Min Interest */}
          <div className="space-y-1">
            <label htmlFor="filter-min-interest" className="text-xs font-medium text-muted-foreground">Min Interest</label>
            <select
              id="filter-min-interest"
              value={filters.minInterest || ''}
              onChange={(e) => updateFilter('minInterest', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="3">3+ Stars</option>
              <option value="4">4+ Stars</option>
              <option value="5">5 Stars Only</option>
            </select>
          </div>

          {/* Data Completeness */}
          {filters.requireCompleteData !== undefined && (
            <div className="space-y-1">
              <label htmlFor="filter-data-quality" className="text-xs font-medium text-muted-foreground">Data Quality</label>
              <select
                id="filter-data-quality"
                value={filters.requireCompleteData ? 'complete' : 'all'}
                onChange={(e) => updateFilter('requireCompleteData', e.target.value === 'complete')}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="complete">Deal-ready only</option>
                <option value="all">Show all</option>
              </select>
            </div>
          )}

          {/* Unreleased */}
          {filters.hideUnreleased !== undefined && (
            <div className="space-y-1">
              <label htmlFor="filter-release-status" className="text-xs font-medium text-muted-foreground">Release Status</label>
              <select
                id="filter-release-status"
                value={filters.hideUnreleased ? 'released' : 'all'}
                onChange={(e) => updateFilter('hideUnreleased', e.target.value === 'released')}
                className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                <option value="released">Released only</option>
                <option value="all">Include unreleased</option>
              </select>
            </div>
          )}

          {/* Early Access */}
          <div className="space-y-1">
            <label htmlFor="filter-early-access" className="text-xs font-medium text-muted-foreground">Early Access</label>
            <select
              id="filter-early-access"
              value={filters.earlyAccess === undefined ? '' : filters.earlyAccess ? 'only' : 'exclude'}
              onChange={(e) => {
                const val = e.target.value;
                updateFilter('earlyAccess', val === '' ? undefined : val === 'only');
              }}
              className="w-full px-2 py-2.5 rounded-md bg-background border border-input text-sm"
            >
              <option value="">Any</option>
              <option value="only">Early Access only</option>
              <option value="exclude">Exclude Early Access</option>
            </select>
          </div>

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
            <label htmlFor="filter-sort-by" className="text-xs font-medium text-muted-foreground">Sort By</label>
            <div className="flex gap-1">
              <select
                id="filter-sort-by"
                value={filters.sortBy || 'title'}
                onChange={(e) => updateFilter('sortBy', e.target.value as GameFiltersType['sortBy'])}
                className="min-w-0 flex-1 px-2 py-2.5 rounded-md bg-background border border-input text-sm"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => updateFilter('sortOrder', filters.sortOrder === 'desc' ? 'asc' : 'desc')}
                aria-label={filters.sortOrder === 'desc' ? 'Sort descending' : 'Sort ascending'}
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
                    maxPrice: undefined,
                    playtimeStatus: undefined,
                    genres: undefined,
                    minReview: undefined,
                    minInterest: undefined,
                    requireCompleteData: filters.requireCompleteData !== undefined ? true : undefined,
                    hideUnreleased: filters.hideUnreleased !== undefined ? true : undefined,
                    earlyAccess: undefined,
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
                aria-label={`Remove ${genre} filter`}
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
