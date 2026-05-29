/**
 * Metadata Refresh
 *
 * Daily LRU drain that pulls fresh Steam appdetails + review summaries for
 * wishlisted and owned games. Keeps `releaseDate`, `isReleased`,
 * `isEarlyAccess`, and the review fields current without depending on the
 * wishlist/library sync (those only enrich *new* rows). Fires a Discord
 * notification when a game graduates from Early Access.
 */

import { getSteamClient, getAndResetSteamApiCalls } from '../steam/client';
import { isEarlyAccessFromCategories } from '../steam/utils';
import {
  getGamesForMetadataRefresh,
  getEarlyAccessSnapshot,
  updateGameMetadata,
  getFirstUserId,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';
import { getDiscordClient } from '../discord/client';
import { emitNotification } from '../notifications/dispatch';
import type { SyncResult, ProgressCallback } from './types';

const BATCH_SIZE = 100;
const DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshMetadata(
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  userId?: string,
): Promise<SyncResult> {
  const syncLogId = createSyncLog('metadata_refresh');

  try {
    const effectiveUserId = userId ?? getFirstUserId();
    const gamesToRefresh = getGamesForMetadataRefresh(effectiveUserId, BATCH_SIZE);

    if (gamesToRefresh.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0, getAndResetSteamApiCalls());
      return {
        stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 },
        syncLogId,
        message: 'No games to refresh',
      };
    }

    console.log(`[MetadataRefresh] Refreshing ${gamesToRefresh.length} games`);

    const steam = getSteamClient();
    const discord = getDiscordClient();
    const graduations: Array<{ gameId: number; title: string; steamAppId: number; headerImageUrl?: string; reviewDescription?: string }> = [];

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    for (const game of gamesToRefresh) {
      if (signal?.aborted) {
        console.log(`[MetadataRefresh] Cancelled after ${attempted} games`);
        break;
      }

      attempted++;
      onProgress?.(attempted, gamesToRefresh.length, { gameName: game.title, status: 'processing' });

      try {
        const details = await steam.getAppDetails(game.steamAppId);
        const reviews = await steam.getReviewSummary(game.steamAppId);

        // Always stamp metadataLastUpdated so a rate-limited row rotates out of
        // the LRU drain instead of getting picked up first the next cycle.
        // Without `details` we can't refresh the release/EA fields (the whole
        // point of this job) — so count those runs as failed even if reviews
        // came back, and skip the EA-graduation check.
        const priorIsEarlyAccess = details ? getEarlyAccessSnapshot(game.id) : null;
        const newIsEarlyAccess = details ? isEarlyAccessFromCategories(details.categories) : null;

        const patch: Parameters<typeof updateGameMetadata>[1] = {};
        if (details) {
          patch.releaseDate = details.release_date?.date;
          // Pass `true` only on launch — leave `isReleased` untouched while
          // `coming_soon` is still true. The query-layer guard would block a
          // false-write anyway, but being explicit avoids relying on it.
          patch.isReleased = details.release_date?.coming_soon === false ? true : undefined;
          patch.isEarlyAccess = newIsEarlyAccess;
        }
        if (reviews) {
          patch.reviewScore = Math.round(
            (reviews.total_positive / Math.max(reviews.total_reviews, 1)) * 100,
          );
          patch.reviewCount = reviews.total_reviews;
          patch.reviewDescription = reviews.review_score_desc;
        }

        updateGameMetadata(game.id, patch);

        if (!details) {
          failed++;
          onProgress?.(attempted, gamesToRefresh.length, { gameName: game.title, status: 'failed' });
          if (attempted < gamesToRefresh.length) await sleep(DELAY_MS);
          continue;
        }

        // EA graduation: was in EA, now isn't.
        if (priorIsEarlyAccess === true && newIsEarlyAccess === false) {
          graduations.push({
            gameId: game.id,
            title: game.title,
            steamAppId: game.steamAppId,
            headerImageUrl: details.header_image,
            reviewDescription: reviews?.review_score_desc,
          });
        }

        succeeded++;
        onProgress?.(attempted, gamesToRefresh.length, { gameName: game.title, status: 'refreshed' });
      } catch (err) {
        console.error(`[MetadataRefresh] ${game.title}:`, err);
        failed++;
        onProgress?.(attempted, gamesToRefresh.length, { gameName: game.title, status: 'error' });
      }

      if (attempted < gamesToRefresh.length) await sleep(DELAY_MS);
    }

    for (const graduation of graduations) {
      // Fan out to in-app + Discord per the user's `release` routing. (Releases
      // and EA graduations share the `release` category.)
      await emitNotification({
        category: 'release',
        userId: effectiveUserId,
        inApp: {
          title: `${graduation.title} left Early Access`,
          body: graduation.reviewDescription
            ? `Now in full release · ${graduation.reviewDescription}`
            : 'Now in full release',
          link: `/games/${graduation.gameId}`,
          metadata: { steamAppId: graduation.steamAppId },
        },
        discord: () =>
          discord.sendEarlyAccessGraduation({
            title: graduation.title,
            steamAppId: graduation.steamAppId,
            headerImageUrl: graduation.headerImageUrl,
            reviewDescription: graduation.reviewDescription,
          }),
      });
    }

    console.log(
      `[MetadataRefresh] Done: ${succeeded} refreshed, ${failed} failed, ${graduations.length} EA graduations`,
    );

    const status = failed > 0 && succeeded === 0 ? 'error' : failed > 0 ? 'partial' : 'success';
    completeSyncLog(syncLogId, status, succeeded, undefined, attempted, failed, getAndResetSteamApiCalls());

    return {
      stats: { attempted, succeeded, failed, skipped: 0 },
      syncLogId,
      message: graduations.length > 0 ? `${graduations.length} game(s) left Early Access` : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message, undefined, undefined, getAndResetSteamApiCalls());
    throw err;
  }
}
