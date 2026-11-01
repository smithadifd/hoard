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
