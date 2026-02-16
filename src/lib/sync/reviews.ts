/**
 * Review & Metadata Enrichment Sync
 *
 * Fetches review scores, descriptions, developer/publisher info,
 * and co-op/multiplayer flags from the Steam Store API for games
 * missing review data (or with stale data older than 30 days).
 */

import { getSteamClient } from '../steam/client';
import {
  getGamesForReviewSync,
  updateGameReviewData,
  upsertTags,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';

const BATCH_SIZE = 100;
const DELAY_MS = 3000; // 3s between games (2 API calls per game)

export async function syncReviews(onProgress?: ProgressCallback, signal?: AbortSignal): Promise<SyncResult> {
  const syncLogId = createSyncLog('reviews');

  try {
    const allGames = getGamesForReviewSync();
    const gamesToSync = allGames.slice(0, BATCH_SIZE);

    console.log(`[ReviewSync] ${allGames.length} games need review data, processing batch of ${gamesToSync.length}`);

    if (gamesToSync.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0);
      return {
        stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
        syncLogId,
        message: 'All games already have review data (refreshes after 30 days)',
      };
    }

    const client = getSteamClient();
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const game of gamesToSync) {
      if (signal?.aborted) {
        console.log(`[ReviewSync] Cancelled after ${attempted} games`);
        break;
      }

      onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'processing' });
      attempted++;

      try {
        // Fetch app details (description, developer, publisher, categories, genres)
        const details = await client.getAppDetails(game.steamAppId);

        // Fetch review summary
        const reviews = await client.getReviewSummary(game.steamAppId);

        if (attempted <= 3) {
          console.log(`[ReviewSync] ${game.title} (${game.steamAppId}): details=${!!details}, reviews=${!!reviews}`);
        }

        if (!details && !reviews) {
          // Both calls failed (rate-limited or delisted) — mark as checked so we skip next time
          updateGameReviewData(game.id, {});
          skipped++;
          onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'skipped' });
          if (attempted < gamesToSync.length) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
          }
          continue;
        }

        // Parse co-op/multiplayer from categories
        const categories = details?.categories ?? [];
        const isCoop = categories.some((c) =>
          c.description.toLowerCase().includes('co-op')
        );
        const isMultiplayer = categories.some((c) =>
          c.description.toLowerCase().includes('multi-player') ||
          c.description.toLowerCase().includes('multiplayer')
        );

        // Build review data
        const reviewData: Parameters<typeof updateGameReviewData>[1] = {};

        if (reviews) {
          reviewData.reviewScore = Math.round(
            (reviews.total_positive / Math.max(reviews.total_reviews, 1)) * 100
          );
          reviewData.reviewCount = reviews.total_reviews;
          reviewData.reviewDescription = reviews.review_score_desc;
        }

        if (details) {
          reviewData.description = details.short_description || undefined;
          reviewData.developer = details.developers?.[0] || undefined;
          reviewData.publisher = details.publishers?.[0] || undefined;
          reviewData.isCoop = isCoop;
          reviewData.isMultiplayer = isMultiplayer;
        }

        updateGameReviewData(game.id, reviewData);

        // Upsert genres from app details
        if (details?.genres && details.genres.length > 0) {
          const genreNames = details.genres.map((g) => g.description);
          upsertTags(game.id, genreNames, 'genre');
        }

        // Upsert category tags
        if (categories.length > 0) {
          const categoryNames = categories.map((c) => c.description);
          upsertTags(game.id, categoryNames, 'category');
        }

        succeeded++;
        onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'enriched' });
      } catch (error) {
        console.error(`[ReviewSync] Error enriching ${game.title}:`, error);
        // Mark as checked to avoid retrying immediately
        updateGameReviewData(game.id, {});
        failed++;
        onProgress?.(attempted, gamesToSync.length, { gameName: game.title, status: 'error' });
      }

      // Rate limiting: 3s between games
      if (attempted < gamesToSync.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    console.log(`[ReviewSync] Done: ${succeeded} enriched, ${skipped} skipped, ${failed} failed out of ${attempted}`);
    completeSyncLog(syncLogId, 'success', succeeded, undefined, attempted, failed);
    return { stats: { attempted, succeeded, failed, skipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
