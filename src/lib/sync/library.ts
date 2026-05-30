/**
 * Steam Library Sync
 *
 * Fetches owned games from Steam API and upserts into the database.
 * Does NOT call getAppDetails() for each game — that would be too slow
 * for large libraries. Only stores what getOwnedGames() returns.
 */

import { getSteamClient, getAndResetSteamApiCalls } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  getExistingGamesByAppIds,
  getPreOwnershipState,
  cascadePurchaseCleanup,
  capturePricePaidSuggestions,
  getSetting,
} from '../db/queries';
import { getDb } from '../db';
import { emitNotification } from '../notifications/dispatch';
import type { SyncResult, ProgressCallback } from './types';

export async function syncLibrary(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const effectiveUserId = userId ?? getFirstUserId();
  const syncLogId = createSyncLog('steam_library');

  try {
    const client = getSteamClient();
    const response = await client.getOwnedGames();

    const total = response.games.length;
    let processed = 0;
    let newlyPurchasedCount = 0;
    // Price-paid suggestions captured this run (written in-txn, notified after commit).
    let capturedSuggestions: { gameId: number; title: string; suggested: number; asOf: string }[] = [];
    // Master opt-out — skip the whole capture (and thus all surfaces) when disabled.
    const suggestPrices = getSetting('price_paid_suggestions_enabled') !== 'false';

    const appIds = response.games.map((g) => g.appid);

    const sqlite = getDb().$client;
    const runSync = sqlite.transaction(() => {
      // Read prior ownership state INSIDE the transaction so a concurrent
      // wishlist sync can't race in between the read and the upserts. Any
      // game that was wishlisted-but-not-owned and is about to be marked
      // owned is a new purchase — cascade its alerts + wishlist cleanup.
      const existing = getExistingGamesByAppIds(appIds);
      const existingGameIds = Array.from(existing.values()).map((g) => g.id);
      const priors = getPreOwnershipState(existingGameIds, effectiveUserId);
      const newlyPurchasedIds = priors
        .filter((p) => p.wasWishlisted && !p.wasOwned)
        .map((p) => p.gameId);

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

      if (newlyPurchasedIds.length > 0) {
        cascadePurchaseCleanup(newlyPurchasedIds, effectiveUserId);
        if (suggestPrices) {
          capturedSuggestions = capturePricePaidSuggestions(newlyPurchasedIds, effectiveUserId);
        }
        newlyPurchasedCount = newlyPurchasedIds.length;
      }
    });
    runSync();

    if (newlyPurchasedCount > 0) {
      console.log(
        `[LibrarySync] Detected ${newlyPurchasedCount} purchase(s) — deactivated alerts, removed from wishlist`,
      );
    }

    // Fire price-paid-suggestion nudges AFTER the commit: emitNotification is async
    // and a better-sqlite3 transaction callback must stay synchronous. Each call is
    // self-isolating (never throws), so a notification failure can't fail the sync.
    for (const s of capturedSuggestions) {
      await emitNotification({
        category: 'price-paid-suggestion',
        userId: effectiveUserId,
        inApp: {
          title: `Confirm what you paid for ${s.title}`,
          body: `Last tracked at ~$${s.suggested.toFixed(2)} on ${s.asOf}. Confirm or update it to unlock realized $/hr.`,
          link: `/games/${s.gameId}`,
          metadata: { gameId: s.gameId, suggested: s.suggested, asOf: s.asOf },
        },
        discord: () => Promise.resolve(false),
      });
    }

    completeSyncLog(syncLogId, 'success', processed, undefined, total, 0, getAndResetSteamApiCalls());
    return { stats: { attempted: total, succeeded: processed, failed: 0, skipped: 0 }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message, undefined, undefined, getAndResetSteamApiCalls());
    throw error;
  }
}
