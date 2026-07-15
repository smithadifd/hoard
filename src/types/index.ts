/**
 * Shared type definitions for the Hoard application.
 */

// Re-export database schema types for convenience
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { ValueReceivedTier, ValueReceivedLens, BetPayoff } from '@/lib/scoring/valueReceived';

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
  hltbMissCount?: number;
  /** Median total playtime (hours) from sampled Steam reviewers (SteamDB-style). */
  steamPlaytimeMedian?: number;
  /** Number of reviews the Steam playtime median is drawn from. */
  steamPlaytimeSampleSize?: number;
  /** Consecutive failed/too-small Steam review samples (detail-view auto-fetch guard). */
  steamPlaytimeMissCount?: number;
  /** Which playtime basis feeds $/hour scoring for this game. */
  playtimeSource?: 'hltb' | 'steam_reviews';

  // User relationship
  isOwned: boolean;
  isWishlisted: boolean;
  isWatchlisted: boolean;
  isIgnored: boolean;
  /** True = on the Hoard wishlist but NOT the user's Steam wishlist (survives Steam sync). */
  wishlistedLocally: boolean;
  autoAlertDisabled: boolean;
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

  // Value received (owned games) — backward-looking "did I get my money's worth?"
  pricePaid?: number;
  /** Phase 3 — system estimate of price paid, captured at purchase, pending user confirmation. */
  pricePaidSuggested?: number;
  /** True when an un-dismissed price-paid suggestion exists and no real price is recorded yet. */
  hasPricePaidSuggestion?: boolean;
  valueReceivedTier?: ValueReceivedTier;
  valueReceivedLens?: ValueReceivedLens;
  completionRatio?: number;
  realizedDollarsPerHour?: number;
  hoursToBreakEven?: number;
  receivedExpectedValue?: boolean;
  valueReceivedSummary?: string;
  /** Post-play enjoyment rating (1-5); undefined = unrated → efficiency/time lens leads. */
  enjoymentRating?: number;
  /** Rating-led verdict headline ("Glad I played it"); set only when rated. */
  valueReceivedHeadline?: string;
  /** Efficiency qualifier ("paid a premium"); set only when it would otherwise be misread. */
  valueReceivedQualifier?: string;
  /** "Did the bet pay off?" — interest→enjoyment delta; set only when both were explicit. */
  betPayoff?: BetPayoff;

  // Release status
  isReleased?: boolean;
  isEarlyAccess?: boolean;

  // Data completeness
  dataCompleteness: 'full' | 'partial' | 'minimal';

  // Data freshness timestamps
  reviewLastUpdated?: string;
  hltbLastUpdated?: string;
  priceLastUpdated?: string;
  metadataLastUpdated?: string;

  // Date a new ATL was hit (populated for view='new-atls'/'recent-deals')
  atlHitDate?: string;
  /** UI hint for which deal-section badge to render. */
  dealBadge?: 'new-atl' | 'discount' | 'below-avg';
  /** % below 90-day average price (populated for view='heating-up'). */
  belowAvgPercent?: number;

  // Source tracking — 'sync' (came from Steam library/wishlist sync) or 'lookup'
  // (created on-demand via the search Cmd+K Steam result click)
  source: 'sync' | 'lookup';

  // Price-history backfill state (detail view only) — drives the once-per-game
  // auto-backfill on the game detail page. NULL backfilledAt + missCount < 3 = eligible.
  priceHistoryBackfilledAt?: string;
  priceHistoryMissCount?: number;
}

/**
 * Filters for browsing games.
 */
export interface GameFilters {
  search?: string;
  view?: 'library' | 'wishlist' | 'watchlist' | 'recent-deals' | 'new-atls' | 'deepest-discounts' | 'heating-up';
  /** For view='recent-deals'|'new-atls': window in days to consider. */
  daysBack?: number;
  /** Game IDs to exclude from the result. Used to dedupe across deal-page sections. */
  excludeGameIds?: number[];
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
  minInterest?: number; // Minimum personal interest rating (1-5)
  strictFilters?: boolean; // When true, NULL values fail filters instead of passing
  excludeTags?: string[]; // Exclude games with these tags
  requireCompleteData?: boolean;
  hideUnreleased?: boolean;
  earlyAccess?: boolean;
  /** Owned-library value filter: true = only games the user has rated, false = only unrated. */
  rated?: boolean;
  /** Owned-library value filter: only games in this Value Received tier (matches the donut buckets). */
  valueReceivedTier?: ValueReceivedTier;
  sortBy?: 'title' | 'playtime' | 'review' | 'price' | 'dealScore' | 'hltbMain' | 'releaseDate' | 'lastPlayed' | 'atlHitDate' | 'discount' | 'belowAvgPercent' | 'valueWaiting' | 'pricePaid' | 'completionRatio' | 'realizedDollarsPerHour' | 'valueReceived';
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
