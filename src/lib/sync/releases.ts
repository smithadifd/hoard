/**
 * Release Status Sync
 *
 * Checks unreleased games against the Steam Store API to detect
 * when `coming_soon` flips to `false`. Fires Discord notifications
 * for newly released games. Designed to run after the price sync.
 */

import { getSteamClient, getAndResetSteamApiCalls } from '../steam/client';
import { getGamesForReleaseCheck, updateReleaseStatus, createSyncLog, completeSyncLog } from '../db/queries';
import { getDiscordClient } from '../discord/client';
import type { SyncResult } from './types';

const DELAY_BETWEEN_CHECKS_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkReleaseStatus(): Promise<SyncResult> {
  const syncLogId = createSyncLog('release_check');
  const unreleasedGames = getGamesForReleaseCheck();

  if (unreleasedGames.length === 0) {
    completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0, getAndResetSteamApiCalls());
    return { stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, syncLogId };
  }

  console.log(`[ReleaseCheck] Checking ${unreleasedGames.length} unreleased games`);

  const steam = getSteamClient();
  const discord = getDiscordClient();
  let checked = 0;
  let released = 0;
  let failed = 0;

  for (const game of unreleasedGames) {
    try {
      const details = await steam.getAppDetails(game.steamAppId);

      if (!details) {
        // App might be delisted or rate-limited — skip
        failed++;
        continue;
      }

      const comingSoon = details.release_date?.coming_soon;
      const dateString = details.release_date?.date;
      const isNowReleased = comingSoon === false;

      // Refresh the release date string on every check — Steam tightens these as
      // launch approaches (e.g. "later in 2026" → "Jul 7, 2026"), and the
      // wishlist sync only fetches appdetails for new games, so this is the only
      // place existing unreleased entries get refreshed.
      updateReleaseStatus(game.id, {
        isReleased: isNowReleased,
        releaseDate: dateString,
      });

      if (isNowReleased) {
        console.log(`[ReleaseCheck] ${game.title} is now released`);
        released++;

        // Send Discord notification
        try {
          await discord.sendReleaseNotification({
            title: game.title,
            steamAppId: game.steamAppId,
            headerImageUrl: details.header_image,
            releaseDate: dateString,
            reviewDescription: details.metacritic?.score
              ? `Metacritic: ${details.metacritic.score}`
              : undefined,
          });
        } catch (notifyError) {
          console.error(`[ReleaseCheck] Discord notification failed for ${game.title}:`, notifyError);
        }
      }

      checked++;
    } catch (error) {
      console.error(`[ReleaseCheck] Error checking ${game.title}:`, error);
      failed++;
    }

    // Rate limit between calls
    if (game !== unreleasedGames[unreleasedGames.length - 1]) {
      await sleep(DELAY_BETWEEN_CHECKS_MS);
    }
  }

  const status = failed > 0 && checked === 0 ? 'error' : failed > 0 ? 'partial' : 'success';
  completeSyncLog(syncLogId, status, checked, undefined, unreleasedGames.length, failed, getAndResetSteamApiCalls());

  if (released > 0) {
    console.log(`[ReleaseCheck] ${released} game(s) newly released`);
  }

  return {
    stats: { attempted: unreleasedGames.length, succeeded: checked, failed, skipped: 0 },
    syncLogId,
    message: released > 0 ? `${released} game(s) newly released` : undefined,
  };
}
