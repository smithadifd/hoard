/**
 * Shared types for sync operations.
 *
 * All sync functions (library, wishlist, prices, hltb, reviews, alerts)
 * share these types for consistent stats tracking and SSE progress reporting.
 */

/**
 * The app's base currency. Everything downstream — the price chart's USD axis,
 * $/hour, all-time-low comparisons, and the dollar-denominated scoring thresholds —
 * assumes USD. ITAD's history/overview feeds return regional storefronts in their
 * native currency (e.g. GamesPlanet UK in GBP) even for a `country: 'US'` query, so
 * we drop non-base-currency rows before they pollute the snapshot history. Plotting a
 * raw GBP amount on a USD axis makes a £31.99 deal look like a sub-ATL "$31.99" dip.
 */
export const BASE_CURRENCY = 'USD';

export interface SyncStats {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface SyncResult {
  stats: SyncStats;
  syncLogId: number;
  message?: string;
}

export type ProgressContext = {
  gameName?: string;
  status?: string;
};

export type ProgressCallback = (
  processed: number,
  total: number,
  context?: ProgressContext
) => void;
