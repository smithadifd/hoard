/**
 * Steam Wishlist Sync
 *
 * Fetches wishlisted games from Steam via IWishlistService/GetWishlist/v1.
 * The new API only returns appid, priority, and date_added — no metadata.
 * For games not already in the DB, we fetch names from Steam appdetails.
 */

import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  getExistingGamesByAppIds,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
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

export async function syncWishlist(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const effectiveUserId = userId ?? getFirstUserId();
  const syncLogId = createSyncLog('steam_wishlist');

  try {
    const client = getSteamClient();
    const wishlistEntries = await client.getWishlist();

    if (wishlistEntries.length === 0) {
      completeSyncLog(syncLogId, 'success', 0);
      return { gamesProcessed: 0, syncLogId };
    }

    const appIds = wishlistEntries.map((e) => e.appid);
    const total = wishlistEntries.length;

    // Check which games already exist in the DB
    const existing = getExistingGamesByAppIds(appIds);

    // Games already in DB: just mark as wishlisted (fast path)
    let processed = 0;
    const needDetails: number[] = [];

    for (const entry of wishlistEntries) {
      if (signal?.aborted) {
        console.log(`[WishlistSync] Cancelled after ${processed} games`);
        break;
      }
      const found = existing.get(entry.appid);
      if (found) {
        // Game exists — just flag as wishlisted
        upsertUserGame(found.id, { isWishlisted: true }, effectiveUserId);
        processed++;
        onProgress?.(processed, total, { gameName: found.title });
      } else {
        needDetails.push(entry.appid);
      }
    }

    // New games: fetch name from Steam Store API (rate-limited)
    for (const appId of needDetails) {
      if (signal?.aborted) {
        console.log(`[WishlistSync] Cancelled after ${processed} games`);
        break;
      }

      const details = await client.getAppDetails(appId);
      const title = details?.name ?? `App ${appId}`;

      const gameId = upsertGameFromSteam({
        steamAppId: appId,
        title,
        headerImageUrl: details?.header_image,
        description: details?.short_description,
        releaseDate: details?.release_date?.date,
        developer: details?.developers?.[0],
        publisher: details?.publishers?.[0],
        isReleased: details?.release_date?.coming_soon === true ? false : undefined,
      });

      upsertUserGame(gameId, { isWishlisted: true }, effectiveUserId);

      // Enrich with review data
      const reviews = await client.getReviewSummary(appId);
      if (reviews) {
        upsertGameFromSteam({
          steamAppId: appId,
          title,
          reviewScore: Math.round(
            (reviews.total_positive / Math.max(reviews.total_reviews, 1)) * 100
          ),
          reviewCount: reviews.total_reviews,
          reviewDescription: reviews.review_score_desc,
        });
      }

      processed++;
      onProgress?.(processed, total, { gameName: title });

      // Rate limit: Steam Store API allows ~200 requests / 5 min.
      // We make 2 calls per game (appdetails + reviews), so 3s per game.
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    completeSyncLog(syncLogId, 'success', processed);
    return { gamesProcessed: processed, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
