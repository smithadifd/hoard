import type { GameFilters } from '@/types';

/**
 * Parse URL search params into a partial GameFilters object.
 * Handles the common filter fields shared across library, wishlist, and backlog pages.
 * Page-specific defaults (sortBy, sortOrder) and view-specific fields
 * (requireCompleteData, hideUnreleased, strictFilters) are applied by each page.
 */
export function parseGameFiltersFromParams(
  params: Record<string, string | string[] | undefined>
): Partial<GameFilters> {
  const filters: Partial<GameFilters> = {};

  if (typeof params.search === 'string') filters.search = params.search;
  if (typeof params.sortBy === 'string') filters.sortBy = params.sortBy as GameFilters['sortBy'];
  if (typeof params.sortOrder === 'string') filters.sortOrder = params.sortOrder as GameFilters['sortOrder'];
  if (typeof params.maxHours === 'string') filters.maxHours = Number(params.maxHours);
  if (typeof params.minHours === 'string') filters.minHours = Number(params.minHours);
  if (typeof params.coop === 'string') filters.coop = params.coop === 'true';
  if (typeof params.onSale === 'string') filters.onSale = params.onSale === 'true';

  if (typeof params.maxPrice === 'string' && !isNaN(Number(params.maxPrice)) && Number(params.maxPrice) >= 0) {
    filters.maxPrice = Number(params.maxPrice);
  }

  if (typeof params.playtime === 'string') {
    filters.playtimeStatus = params.playtime as GameFilters['playtimeStatus'];
  }

  if (typeof params.genres === 'string' && params.genres) {
    filters.genres = params.genres.split(',');
  }

  if (typeof params.minReview === 'string') filters.minReview = Number(params.minReview);

  if (typeof params.minInterest === 'string' && Number(params.minInterest) >= 1 && Number(params.minInterest) <= 5) {
    filters.minInterest = Number(params.minInterest);
  }

  return filters;
}
