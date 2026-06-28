/**
 * Steam-Review Playtime Backfill
 *
 * Samples reviewer playtime medians for wishlisted games that don't have one yet,
 * so the wishlist's playtime-divergence signal (reviewer hours vs HLTB) has data
 * to work with. Until this runs, `steamPlaytimeMedian` is only populated on-demand
 * when a game's detail page is opened — so almost no wishlist game has it.
 *
 * Bounded + gentle by design (free, low-friction tenet):
 *   - scoped to the wishlist only (not the whole library),
 *   - capped at BATCH_SIZE games per run, so it drains a large backlog over a few
 *     nightly runs rather than one long Steam burst,
 *   - 3s between games (matches reviews.ts/metadata.ts; the reviews endpoint is the
 *     same ~200 req / 5 min budget),
 *   - self-limiting: once a game has a median (or hits the give-up miss cap), the
 *     eligibility query skips it forever, so steady-state load trends to zero.
 *
 * Mirrors {@link syncHltb} in structure (batch + per-game backoff + sync log).
 */

import { getSteamClient, getAndResetSteamApiCalls } from '../steam/client';
import {
  getGamesForSteamPlaytimeSync,
  updateGameSteamPlaytime,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';
import { computePlaytimeStats } from '../utils/playtime';
import { STEAM_PLAYTIME_MIN_SAMPLE } from '../playtimeSource';
import type { SyncResult, ProgressCallback } from './types';
import { SUCCESS_RATE_THRESHOLDS } from './health';

const BATCH_SIZE = 50; // Games per run — drains the one-time backlog over a few nights
const DELAY_MS = 3000; // Reviews endpoint shares the ~200 req / 5 min Steam budget

export async function syncSteamPlaytime(
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const syncLogId = createSyncLog('steam_playtime');

  try {
    const eligible = getGamesForSteamPlaytimeSync();
    const gamesToSync = eligible.slice(0, BATCH_SIZE);

    console.log(
      `[SteamPlaytimeSync] ${eligible.length} wishlist games need a playtime median, processing batch of ${gamesToSync.length}`,
    );

    if (gamesToSync.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0, getAndResetSteamApiCalls());
      return {
        stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
        syncLogId,
        message: 'All wishlisted games already have a playtime median (or hit the give-up cap)',
      };
    }

    const client = getSteamClient();
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const game of gamesToSync) {
      if (signal?.aborted) {
        console.log(`[SteamPlaytimeSync] Cancelled after ${attempted} games`);
        break;
      }

      onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'processing' });
      attempted++;

      try {
        const playtimes = await client.getReviewPlaytimes(game.steamAppId);
        const stats = playtimes === null ? null : computePlaytimeStats(playtimes);

        if (stats && stats.sampleSize >= STEAM_PLAYTIME_MIN_SAMPLE) {
          updateGameSteamPlaytime(game.id, stats); // stores median + resets miss count + recomputes deal score
          succeeded++;
          onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'matched' });
        } else {
          updateGameSteamPlaytime(game.id, null); // too small / no sample → increments miss count (backoff)
          skipped++;
          onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'skipped' });
        }
      } catch (error) {
        console.error(`[SteamPlaytimeSync] Error sampling "${game.title}":`, error);
        failed++;
        onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'error' });
      }

      // Rate limit: space requests so we stay polite to the Steam reviews endpoint.
      if (attempted < gamesToSync.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    console.log(
      `[SteamPlaytimeSync] Done: ${succeeded} sampled, ${skipped} too-small, ${failed} failed out of ${attempted}`,
    );
    const successRate = attempted > 0 ? succeeded / attempted : 1;
    const threshold = SUCCESS_RATE_THRESHOLDS['steam_playtime'] ?? 0.3;
    const logStatus = successRate < threshold ? 'partial' : 'success';
    completeSyncLog(syncLogId, logStatus, succeeded, undefined, attempted, failed, getAndResetSteamApiCalls());
    return { stats: { attempted, succeeded, failed, skipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message, undefined, undefined, getAndResetSteamApiCalls());
    throw error;
  }
}
