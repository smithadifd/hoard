/**
 * Steam Wishlist Sync
 *
 * Fetches wishlisted games from Steam and upserts into the database.
 * The wishlist API returns richer data than the library API:
 * review scores, tags, release dates, and capsule images.
 */

import { getEffectiveConfig } from '../config';
import { createSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  upsertTags,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';

export interface SyncResult {
  gamesProcessed: number;
  syncLogId: number;
}

export async function syncWishlist(): Promise<SyncResult> {
  const config = getEffectiveConfig();

  if (!config.steamApiKey || !config.steamUserId) {
    throw new Error('Steam API Key and User ID are required. Configure them in Settings.');
  }

  const syncLogId = createSyncLog('steam_wishlist');

  try {
    const client = createSteamClient(config.steamApiKey, config.steamUserId);
    const wishlistItems = await client.getWishlist();

    let processed = 0;
    for (const [appIdStr, item] of Object.entries(wishlistItems)) {
      const steamAppId = parseInt(appIdStr);
      if (isNaN(steamAppId)) continue;

      const gameId = upsertGameFromSteam({
        steamAppId,
        title: item.name,
        headerImageUrl: item.capsule || undefined,
        reviewScore: item.reviews_percent || undefined,
        reviewCount: item.reviews_total ? parseInt(item.reviews_total) : undefined,
        reviewDescription: item.review_desc || undefined,
        releaseDate: item.release_string || undefined,
      });

      upsertUserGame(gameId, {
        isWishlisted: true,
      });

      // Wishlist items come with tags
      if (item.tags && item.tags.length > 0) {
        upsertTags(gameId, item.tags, 'tag');
      }

      processed++;
    }

    completeSyncLog(syncLogId, 'success', processed);
    return { gamesProcessed: processed, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
