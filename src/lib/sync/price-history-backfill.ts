/**
 * Automatic ITAD Price History Backfill (enrichment job)
 *
 * Walks games that have an itad_game_id but have never had their full ITAD
 * history pulled, fetches the historical sale events, and stamps
 * `price_history_backfilled_at` so the game is skipped on subsequent runs.
 *
 * - Scope: games in user_games (owned, wishlisted, or watchlisted). When
 *   invoked with a userId, scoped to that user's games only.
 * - Depth: full history (since 2012-01-01) — matches the manual button's
 *   "All available" depth.
 * - Idempotent: the (gameId, store, snapshotDate) unique index on
 *   price_snapshots silently drops duplicates, so re-runs are safe.
 * - Backoff: after PRICE_HISTORY_GIVE_UP_MISSES consecutive failures, the
 *   game is marked backfilled anyway so we stop hammering ITAD for it.
 * - Concurrency: a module-level guard prevents the cron and any manual
 *   trigger from running the loop concurrently. The second caller returns
 *   immediately with a no-op result.
 */

import { backfillPriceHistory } from './prices-history';
import {
  createSyncLog,
  completeSyncLog,
  getGamesForPriceHistoryBackfill,
  markPriceHistoryBackfilled,
  incrementPriceHistoryMissCount,
} from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';

// ITAD's published rate ceiling for the history endpoint is 1000 / 5 min
// (200/min). 100 games per batch × 1s = 100s, ~60 req/min — well under the cap
// and leaves headroom for concurrent batch-endpoint calls from price-check.
const BATCH_SIZE = 100;
const REQUEST_DELAY_MS = 1000;

// Earliest date ITAD started tracking — matches the manual "All available" depth
const FULL_HISTORY_SINCE = new Date('2012-01-01T00:00:00Z');

// Module-level concurrency guard. Both the cron and manual /api/sync POSTs
// invoke this function directly, so the scheduler's per-task isRunning flag
// is not enough on its own.
let isRunning = false;

interface RunOptions {
  /**
   * If true, keep pulling batches until no eligible games remain. Used for
   * onboarding priming — a brand-new user with 500 games shouldn't have to
   * wait 5 nights for their charts to populate.
   */
  drain?: boolean;
  /**
   * Restrict the candidate pool to games owned/wishlisted/watchlisted by this
   * user. Omitted for cron runs (which process every user's games).
   */
  userId?: string;
}

async function runBackfill(
  onProgress: ProgressCallback | undefined,
  signal: AbortSignal | undefined,
  options: RunOptions,
): Promise<SyncResult> {
  const source = options.drain ? 'price-history-prime' : 'price-history-backfill';

  if (isRunning) {
    console.log(`[PriceHistoryBackfill] ${source} skipped — another run in progress`);
    const syncLogId = createSyncLog(source);
    completeSyncLog(syncLogId, 'success', 0, 'Skipped — another backfill is in progress', 0, 0);
    return {
      stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
      syncLogId,
      message: 'Another backfill is already running',
    };
  }

  isRunning = true;
  const syncLogId = createSyncLog(source);

  try {
    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let batchNumber = 0;

    while (true) {
      const candidates = getGamesForPriceHistoryBackfill(BATCH_SIZE, options.userId);
      batchNumber++;

      if (candidates.length === 0) {
        if (batchNumber === 1) {
          console.log('[PriceHistoryBackfill] No eligible games — nothing to do');
        } else {
          console.log(
            `[PriceHistoryBackfill] Drain complete after ${batchNumber - 1} batch(es)`,
          );
        }
        break;
      }

      console.log(
        `[PriceHistoryBackfill] Batch ${batchNumber}: ${candidates.length} games`,
      );

      for (const game of candidates) {
        if (signal?.aborted) {
          console.log(
            `[PriceHistoryBackfill] Cancelled after ${totalAttempted} games`,
          );
          completeSyncLog(
            syncLogId,
            'success',
            totalSucceeded,
            undefined,
            totalAttempted,
            totalFailed,
          );
          return {
            stats: {
              attempted: totalAttempted,
              succeeded: totalSucceeded,
              failed: totalFailed,
              skipped: 0,
            },
            syncLogId,
          };
        }

        onProgress?.(totalAttempted, totalAttempted + candidates.length, {
          gameName: game.title,
          status: 'processing',
        });
        totalAttempted++;

        try {
          const result = await backfillPriceHistory(game.id, {
            since: FULL_HISTORY_SINCE,
          });
          markPriceHistoryBackfilled(game.id);
          totalSucceeded++;
          onProgress?.(totalAttempted, totalAttempted + candidates.length, {
            gameName: game.title,
            status: `+${result.inserted} snapshots`,
          });
        } catch (error) {
          console.error(
            `[PriceHistoryBackfill] Failed for "${game.title}" (${game.id}):`,
            error,
          );
          incrementPriceHistoryMissCount(game.id);
          totalFailed++;
          onProgress?.(totalAttempted, totalAttempted + candidates.length, {
            gameName: game.title,
            status: 'error',
          });
        }

        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      }

      if (!options.drain) break;
    }

    console.log(
      `[PriceHistoryBackfill] Done: ${totalSucceeded} succeeded, ${totalFailed} failed out of ${totalAttempted}`,
    );
    completeSyncLog(
      syncLogId,
      'success',
      totalSucceeded,
      undefined,
      totalAttempted,
      totalFailed,
    );
    return {
      stats: {
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed,
        skipped: 0,
      },
      syncLogId,
      message:
        totalAttempted === 0 ? 'All eligible games already backfilled' : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  } finally {
    isRunning = false;
  }
}

/**
 * Steady-state nightly backfill: one BATCH_SIZE chunk per invocation.
 * Signature matches the SSE wrapper's expectation of `(onProgress, signal, userId)`.
 */
export async function syncPriceHistoryBackfill(
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  userId?: string,
): Promise<SyncResult> {
  return runBackfill(onProgress, signal, { userId });
}

/**
 * Drain-mode wrapper for onboarding flows. Loops batches until every eligible
 * game is enriched. Signature also matches the SSE wrapper, so client
 * disconnects abort the run and onboarding can scope it to a specific user.
 *
 * For a 500-game library, expect ~8 minutes of background ITAD calls.
 */
export async function primePriceHistory(
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  userId?: string,
): Promise<SyncResult> {
  return runBackfill(onProgress, signal, { drain: true, userId });
}
