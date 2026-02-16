/**
 * Shared types for sync operations.
 *
 * All sync functions (library, wishlist, prices, hltb, reviews, alerts)
 * share these types for consistent stats tracking and SSE progress reporting.
 */

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
