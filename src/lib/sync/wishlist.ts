/**
 * Steam Wishlist Sync
 *
 * Fetches wishlisted games from Steam via IWishlistService/GetWishlist/v1.
 * The new API only returns appid, priority, and date_added — no metadata.
 * For games not already in the DB, we fetch names from Steam appdetails.
 */

import { eq, and, sql } from 'drizzle-orm';
import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  getExistingGamesByAppIds,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  updateUserGame,
} from '../db/queries';
import { getDb } from '../db/index';
import { games, userGames } from '../db/schema';
import type { SyncResult, ProgressCallback } from './types';

export async function syncWishlist(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const effectiveUserId = userId ?? getFirstUserId();
  const syncLogId = createSyncLog('steam_wishlist');

  try {
    const client = getSteamClient();
    const wishlistEntries = await client.getWishlist();

    if (wishlistEntries.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0);
      return { stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, syncLogId };
    }

    const appIds = wishlistEntries.map((e) => e.appid);
    const total = wishlistEntries.length;

    // Fetch locally-removed app IDs so sync does not re-add them
    const db = getDb();
    const removedRows = db
      .select({ steamAppId: games.steamAppId })
      .from(games)
      .innerJoin(userGames, eq(games.id, userGames.gameId))
      .where(
        and(
          eq(userGames.userId, effectiveUserId),
          sql`${userGames.wishlistRemovedAt} IS NOT NULL`
        )
      )
      .all();
    const removedAppIds = new Set(removedRows.map((r) => r.steamAppId));

    // Check which games already exist in the DB
    const existing = getExistingGamesByAppIds(appIds);

    // Games already in DB: just mark as wishlisted (fast path)
    let processed = 0;
    let skipped = 0;
    const needDetails: number[] = [];

    for (const entry of wishlistEntries) {
      if (signal?.aborted) {
        console.log(`[WishlistSync] Cancelled after ${processed} games`);
        break;
      }
      // Skip games the user has locally removed
      if (removedAppIds.has(entry.appid)) {
        skipped++;
        onProgress?.(processed + skipped, total, { gameName: '[skipped — locally removed]' });
        continue;
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
      // Skip locally-removed games (guard for needDetails path)
      if (removedAppIds.has(appId)) {
        processed++;
        onProgress?.(processed, total, { gameName: '[skipped — locally removed]' });
        continue;
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
        isReleased: details?.release_date?.coming_soon === true ? false : details?.release_date ? true : undefined,
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

    // Auto-remove games no longer on Steam's wishlist (Steam = source of truth)
    // Only run if sync completed fully — a cancelled sync has incomplete data
    if (!signal?.aborted) {
      const steamAppIdSet = new Set(appIds);
      const hoardWishlisted = db
        .select({ gameId: userGames.gameId, steamAppId: games.steamAppId })
        .from(userGames)
        .innerJoin(games, eq(games.id, userGames.gameId))
        .where(
          and(
            eq(userGames.userId, effectiveUserId),
            eq(userGames.isWishlisted, true),
            sql`${userGames.wishlistRemovedAt} IS NULL`
          )
        )
        .all();

      let removedCount = 0;
      for (const row of hoardWishlisted) {
        if (!steamAppIdSet.has(row.steamAppId)) {
          updateUserGame(row.gameId, { isWishlisted: false }, effectiveUserId);
          removedCount++;
        }
      }
      if (removedCount > 0) {
        console.log(`[WishlistSync] Removed ${removedCount} game(s) no longer on Steam wishlist`);
      }
    }

    completeSyncLog(syncLogId, 'success', processed, undefined, total, skipped);
    return { stats: { attempted: total, succeeded: processed, failed: 0, skipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
