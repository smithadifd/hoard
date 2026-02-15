/**
 * Shared type definitions for the Hoard application.
 */

// Re-export database schema types for convenience
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * A game with all enriched data, ready for display.
 */
export interface EnrichedGame {
  id: number;
  steamAppId: number;
  title: string;
  description?: string;
  headerImageUrl?: string;
  releaseDate?: string;
  developer?: string;
  publisher?: string;

  // Reviews
  reviewScore?: number;
  reviewCount?: number;
  reviewDescription?: string;

  // Play time
  hltbMain?: number;
  hltbMainExtra?: number;
  hltbCompletionist?: number;
  hltbManual?: boolean;

  // User relationship
  isOwned: boolean;
  isWishlisted: boolean;
  isWatchlisted: boolean;
  isIgnored: boolean;
  playtimeMinutes: number;
  personalInterest: number;
  lastPlayed?: string;

  // Tags
  tags: string[];
  genres: string[];
  isCoop: boolean;
  isMultiplayer: boolean;

  // Current pricing
  currentPrice?: number;
  regularPrice?: number;
  discountPercent?: number;
  historicalLow?: number;
  isAtHistoricalLow?: boolean;
  bestStore?: string;
  storeUrl?: string;

  // Computed
  dollarsPerHour?: number;
  dealScore?: number;
  dealRating?: 'excellent' | 'great' | 'good' | 'okay' | 'poor';
  dealSummary?: string;

  // Release status
  isReleased?: boolean;

  // Data completeness
  dataCompleteness: 'full' | 'partial' | 'minimal';

  // Data freshness timestamps
  reviewLastUpdated?: string;
  hltbLastUpdated?: string;
  priceLastUpdated?: string;
}

/**
 * Filters for browsing games.
 */
export interface GameFilters {
  search?: string;
  view?: 'library' | 'wishlist' | 'watchlist';
  owned?: boolean;
  played?: boolean; // Has any playtime
  playtimeStatus?: 'unplayed' | 'underplayed' | 'backlog' | 'play-again'; // unplayed=0min, underplayed=1-60min, backlog=unplayed OR barely started (<X% of HLTB), play-again=played significantly + dormant
  maxHours?: number; // Max HLTB main hours
  minHours?: number;
  genres?: string[];
  tags?: string[];
  coop?: boolean;
  multiplayer?: boolean;
  minReview?: number; // Minimum review percentage
  maxReviewCount?: number; // Maximum review count (for Hidden Gems: exclude popular titles)
  maxPrice?: number;
  onSale?: boolean;
  strictFilters?: boolean; // When true, NULL values fail filters instead of passing
  excludeTags?: string[]; // Exclude games with these tags
  requireCompleteData?: boolean;
  hideUnreleased?: boolean;
  sortBy?: 'title' | 'playtime' | 'review' | 'price' | 'dealScore' | 'hltbMain' | 'releaseDate' | 'lastPlayed';
  sortOrder?: 'asc' | 'desc';
}

/**
 * API response wrapper.
 */
export interface ApiResponse<T> {
  data: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}
