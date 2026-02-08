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

export interface SyncResult {
  gamesProcessed: number;
  syncLogId: number;
  message?: string;
}

export type ProgressContext = {
  gameName?: string;
  status?: 'matched' | 'skipped' | 'error' | 'processing';
};

export type ProgressCallback = (processed: number, total: number, context?: ProgressContext) => void;

const SIMILARITY_THRESHOLD = 0.4;
const BATCH_SIZE = 50; // Process up to 50 games per sync run (~1 min)

export async function syncHltb(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<SyncResult> {
  const syncLogId = createSyncLog('hltb');

  try {
    const allGames = getGamesForHltbSync();
    const gamesToSync = allGames.slice(0, BATCH_SIZE);

    console.log(`[HLTBSync] ${allGames.length} games need HLTB data, processing batch of ${gamesToSync.length}`);

    if (gamesToSync.length === 0) {
      completeSyncLog(syncLogId, 'success', 0);
      return { gamesProcessed: 0, syncLogId, message: 'All games already have HLTB data (refreshes after 90 days)' };
    }

    const client = getHLTBClient();
    let processed = 0;
    let matched = 0;

    for (const game of gamesToSync) {
      if (signal?.aborted) {
        console.log(`[HLTBSync] Cancelled after ${processed} games`);
        break;
      }

      onProgress?.(processed, gamesToSync.length, { gameName: game.title, status: 'processing' });

      const result = await client.search(game.title);

      if (result && result.similarity >= SIMILARITY_THRESHOLD) {
        updateGameHltbData(game.id, {
          hltbId: parseInt(result.id, 10) || undefined,
          hltbMain: result.gameplayMain > 0 ? result.gameplayMain : undefined,
          hltbMainExtra: result.gameplayMainExtra > 0 ? result.gameplayMainExtra : undefined,
          hltbCompletionist: result.gameplayCompletionist > 0 ? result.gameplayCompletionist : undefined,
        });
        matched++;
        onProgress?.(processed + 1, gamesToSync.length, { gameName: game.title, status: 'matched' });
      } else {
        // Mark as checked so we don't re-query on next sync
        updateGameHltbData(game.id, {});
        onProgress?.(processed + 1, gamesToSync.length, { gameName: game.title, status: 'skipped' });
      }

      processed++;

      // Rate limiting: 1s between requests (be polite to HLTB)
      if (processed < gamesToSync.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`[HLTBSync] Done: ${matched} matched, ${processed - matched} skipped`);
    completeSyncLog(syncLogId, 'success', matched);
    return { gamesProcessed: matched, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
