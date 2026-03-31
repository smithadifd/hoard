/**
 * Steam Library Sync
 *
 * Fetches owned games from Steam API and upserts into the database.
 * Does NOT call getAppDetails() for each game — that would be too slow
 * for large libraries. Only stores what getOwnedGames() returns.
 */

import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
} from '../db/queries';
import { getDb } from '../db';
import type { SyncResult, ProgressCallback } from './types';

export async function syncLibrary(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const effectiveUserId = userId ?? getFirstUserId();
  const syncLogId = createSyncLog('steam_library');

  try {
    const client = getSteamClient();
    const response = await client.getOwnedGames();

    const total = response.games.length;
    let processed = 0;

    const sqlite = getDb().$client;
    const runSync = sqlite.transaction(() => {
      for (const steamGame of response.games) {
        if (signal?.aborted) {
          console.log(`[LibrarySync] Cancelled after ${processed} games`);
          break;
        }

        const gameId = upsertGameFromSteam({
          steamAppId: steamGame.appid,
          title: steamGame.name,
        });

        upsertUserGame(gameId, {
          isOwned: true,
          playtimeMinutes: steamGame.playtime_forever,
          playtimeRecentMinutes: steamGame.playtime_2weeks ?? 0,
          lastPlayed:
            steamGame.rtime_last_played > 0
              ? new Date(steamGame.rtime_last_played * 1000).toISOString()
              : undefined,
        }, effectiveUserId);

        processed++;
        onProgress?.(processed, total, { gameName: steamGame.name });
      }
    });
    runSync();

    completeSyncLog(syncLogId, 'success', processed, undefined, total, 0);
    return { stats: { attempted: total, succeeded: processed, failed: 0, skipped: 0 }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
