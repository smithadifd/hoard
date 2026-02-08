/**
 * Steam Library Sync
 *
 * Fetches owned games from Steam API and upserts into the database.
 * Does NOT call getAppDetails() for each game — that would be too slow
 * for large libraries. Only stores what getOwnedGames() returns.
 */

import { getEffectiveConfig } from '../config';
import { createSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';

export interface SyncResult {
  gamesProcessed: number;
  syncLogId: number;
}

export type ProgressContext = {
  gameName?: string;
  status?: 'matched' | 'skipped' | 'error' | 'processing';
};

export type ProgressCallback = (processed: number, total: number, context?: ProgressContext) => void;

export async function syncLibrary(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<SyncResult> {
  const config = getEffectiveConfig();

  if (!config.steamApiKey || !config.steamUserId) {
    throw new Error('Steam API Key and User ID are required. Configure them in Settings.');
  }

  const syncLogId = createSyncLog('steam_library');

  try {
    const client = createSteamClient(config.steamApiKey, config.steamUserId);
    const response = await client.getOwnedGames();

    const total = response.games.length;
    let processed = 0;
    for (const steamGame of response.games) {
      if (signal?.aborted) {
        console.log(`[LibrarySync] Cancelled after ${processed} games`);
        break;
      }

      const gameId = upsertGameFromSteam({
        steamAppId: steamGame.appid,
        title: steamGame.name,
        // Header image auto-generated from appid
      });

      upsertUserGame(gameId, {
        isOwned: true,
        playtimeMinutes: steamGame.playtime_forever,
        playtimeRecentMinutes: steamGame.playtime_2weeks ?? 0,
        lastPlayed:
          steamGame.rtime_last_played > 0
            ? new Date(steamGame.rtime_last_played * 1000).toISOString()
            : undefined,
      });

      processed++;
      onProgress?.(processed, total, { gameName: steamGame.name });
    }

    completeSyncLog(syncLogId, 'success', processed);
    return { gamesProcessed: processed, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
