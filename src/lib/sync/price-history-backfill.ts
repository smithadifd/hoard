/**
 * Automatic ITAD Price History Backfill (enrichment job)
 *
 * Walks games that have an itad_game_id but have never had their full ITAD
 * history pulled, fetches the historical sale events, and stamps
 * `price_history_backfilled_at` so the game is skipped on subsequent runs.
 * When that pool leaves room in the batch, it also retries stamped games whose
 * stored history falls implausibly short of their launch (see history-reach.ts)
 * once their stamp is older than BACKFILL_RETRY_COOLDOWN_DAYS — a give-up after
 * transient provider errors, or an empty pull, must not leave a game short forever.
 *
 * - Scope: games in user_games (owned, wishlisted, or watchlisted). When
 *   invoked with a userId, scoped to that user's games only.
 * - Depth: full history (since 2012-01-01) — matches the manual button's
 *   "All available" depth.
 * - Idempotent: the (gameId, store, snapshotDate) unique index on
 *   price_snapshots silently drops duplicates, so re-runs are safe.
 * - Backoff: after PRICE_HISTORY_GIVE_UP_MISSES consecutive failures, the
 *   game is stamped so the never-backfilled pool stops picking it up; the
 *   reach-aware retry pool revisits it once per cooldown.
 * - Concurrency: a module-level guard prevents the cron and any manual
 *   trigger from running the loop concurrently. The second caller returns
 *   immediately with a no-op result.
 */

import { backfillPriceHistory } from './prices-history';
import {
  assessHistoryReach,
  selfHealDisposition,
  BACKFILL_RETRY_COOLDOWN_DAYS,
} from './history-reach';
import {
  createSyncLog,
  completeSyncLog,
  getGamesForPriceHistoryBackfill,
  getPriceHistoryRetryCandidates,
  markPriceHistoryBackfilled,
  incrementPriceHistoryMissCount,
  PRICE_HISTORY_GIVE_UP_MISSES,
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

/**
 * One batch of work: the never-backfilled pool first, then — if there is room —
 * stamped games whose history is short of launch and whose stamp has aged past
 * the cooldown. The reach rule is applied here (release dates are Steam
 * free-text, so the query returns the raw fields and JS judges them); the
 * provider is only called for games `selfHealDisposition` says are due.
 */
function selectBatch(userId: string | undefined, now: Date) {
  const candidates: Array<{ id: number; title: string; itadGameId: string }> =
    getGamesForPriceHistoryBackfill(BATCH_SIZE, userId);
  const room = BATCH_SIZE - candidates.length;
  if (room <= 0) return candidates;

  const cutoff = new Date(now.getTime() - BACKFILL_RETRY_COOLDOWN_DAYS * 86_400_000);
  const retries = getPriceHistoryRetryCandidates(cutoff, userId)
    .filter(
      (g) =>
        selfHealDisposition({ ...g, reach: assessHistoryReach(g) }, now, PRICE_HISTORY_GIVE_UP_MISSES) === 'due',
    )
    .slice(0, room)
    .map((g) => ({ id: g.id, title: g.title, itadGameId: g.itadGameId }));
  return [...candidates, ...retries];
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
      const candidates = selectBatch(options.userId, new Date());
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
