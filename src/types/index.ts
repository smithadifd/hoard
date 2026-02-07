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

  // User relationship
  isOwned: boolean;
  isWishlisted: boolean;
  isWatchlisted: boolean;
  playtimeMinutes: number;
  personalInterest: number;

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
}

/**
 * Filters for browsing games.
 */
export interface GameFilters {
  search?: string;
  view?: 'library' | 'wishlist' | 'watchlist';
  owned?: boolean;
  played?: boolean; // Has any playtime
  maxHours?: number; // Max HLTB main hours
  minHours?: number;
  genres?: string[];
  tags?: string[];
  coop?: boolean;
  multiplayer?: boolean;
  minReview?: number; // Minimum review percentage
  maxPrice?: number;
  onSale?: boolean;
  sortBy?: 'title' | 'playtime' | 'review' | 'price' | 'dealScore' | 'hltbMain' | 'releaseDate';
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
