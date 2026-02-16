/**
 * HLTB Duration Sync
 *
 * Fetches game duration estimates from HowLongToBeat for all games
 * missing HLTB data (or with stale data older than 90 days).
 * Persists results to the games table for use in value scoring.
 */

import { getHLTBClient } from '../hltb/client';
import {
  getGamesForHltbSync,
  updateGameHltbData,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';
import { SUCCESS_RATE_THRESHOLDS } from './health';

const SIMILARITY_THRESHOLD = 0.4;
const BATCH_SIZE = 100; // Process up to 100 games per sync run

export async function syncHltb(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<SyncResult> {
  const syncLogId = createSyncLog('hltb');

  try {
    const allGames = getGamesForHltbSync();
    const gamesToSync = allGames.slice(0, BATCH_SIZE);

    console.log(`[HLTBSync] ${allGames.length} games need HLTB data, processing batch of ${gamesToSync.length}`);

    if (gamesToSync.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0);
      return {
        stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
        syncLogId,
        message: 'All games already have HLTB data (refreshes after 90 days)',
      };
    }

    const client = getHLTBClient();
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const game of gamesToSync) {
      if (signal?.aborted) {
        console.log(`[HLTBSync] Cancelled after ${attempted} games`);
        break;
      }

      onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'processing' });
      attempted++;

      try {
        const result = await client.search(game.title);

        if (result && result.similarity >= SIMILARITY_THRESHOLD) {
          updateGameHltbData(game.id, {
            hltbId: parseInt(result.id, 10) || undefined,
            hltbMain: result.gameplayMain > 0 ? result.gameplayMain : undefined,
            hltbMainExtra: result.gameplayMainExtra > 0 ? result.gameplayMainExtra : undefined,
            hltbCompletionist: result.gameplayCompletionist > 0 ? result.gameplayCompletionist : undefined,
          });
          succeeded++;
          onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'matched' });
        } else {
          // Mark as checked so we don't re-query on next sync
          updateGameHltbData(game.id, {});
          skipped++;
          onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'skipped' });
        }
      } catch (error) {
        console.error(`[HLTBSync] Error searching for "${game.title}":`, error);
        failed++;
        onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'error' });
      }

      // Rate limiting: 1s between requests (be polite to HLTB)
      if (attempted < gamesToSync.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`[HLTBSync] Done: ${succeeded} matched, ${skipped} skipped, ${failed} failed out of ${attempted}`);
    const successRate = attempted > 0 ? succeeded / attempted : 1;
    const threshold = SUCCESS_RATE_THRESHOLDS['hltb'] ?? 0.2;
    const logStatus = successRate < threshold ? 'partial' : 'success';
    completeSyncLog(syncLogId, logStatus, succeeded, undefined, attempted, failed);
    return { stats: { attempted, succeeded, failed, skipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
