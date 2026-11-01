/**
 * Manual "Refresh from Steam" for one game.
 *
 * Re-pulls the review summary and store details, re-samples the reviewer
 * playtime median, and retries HowLongToBeat, ignoring every schedule and
 * give-up cap. It's the escape hatch for anything the automatic freshness
 * rules (see lib/freshness.ts) miss.
 *
 * It deliberately leaves `isReleased` and `isEarlyAccess` alone: the release
 * check and the metadata refresh notice those transitions by comparing old and
 * new values, and send the "out now" and "left Early Access" notifications. A
 * manual refresh that wrote them first would swallow those notifications.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index';
import { games } from '../db/schema';
import { getSteamClient } from '../steam/client';
import { getHLTBClient } from '../hltb/client';
import {
  updateGameReviewData,
  updateGameSteamPlaytime,
  updateGameHltbData,
} from '../db/queries';
import { saveStoreDetails } from './store-details';
import { computePlaytimeStats } from '../utils/playtime';
import { STEAM_PLAYTIME_MIN_SAMPLE } from '../playtimeSource';

const HLTB_SIMILARITY_THRESHOLD = 0.4;

export interface GameRefreshResult {
  reviews: 'updated' | 'unavailable' | 'error';
  playtime: 'updated' | 'too_few_reviews' | 'error';
  hltb: 'matched' | 'no_match' | 'manual' | 'error';
}

/** Returns null when the game doesn't exist. */
export async function refreshGameFromSources(gameId: number): Promise<GameRefreshResult | null> {
  const game = getDb()
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      hltbManual: games.hltbManual,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  if (!game) return null;

  const steam = getSteamClient();
  const result: GameRefreshResult = { reviews: 'error', playtime: 'error', hltb: 'error' };

  // 1. Store details and review summary, saved independently. Only the review
  // write stamps `reviewLastUpdated` (shown as review freshness), so a failed
  // review request never reads as fresh reviews.
  try {
    const details = await steam.getAppDetails(game.steamAppId);
    if (details) saveStoreDetails(game.id, details);
    const reviews = await steam.getReviewSummary(game.steamAppId);
    if (reviews) {
      updateGameReviewData(game.id, {
        reviewScore: Math.round((reviews.total_positive / Math.max(reviews.total_reviews, 1)) * 100),
        reviewCount: reviews.total_reviews,
        reviewDescription: reviews.review_score_desc,
      });
      result.reviews = 'updated';
    } else {
      result.reviews = 'unavailable';
    }
  } catch (error) {
    console.error(`[RefreshGame] Steam details/reviews for "${game.title}":`, error);
  }

  // 2. Reviewer playtime median. Sampled whatever the schedule says.
  try {
    const playtimes = await steam.getReviewPlaytimes(game.steamAppId);
    // null means the Steam request failed: report it, and don't count a miss.
    const stats = playtimes === null ? undefined : computePlaytimeStats(playtimes);
    if (stats === undefined) {
      result.playtime = 'error';
    } else if (stats && stats.sampleSize >= STEAM_PLAYTIME_MIN_SAMPLE) {
      updateGameSteamPlaytime(game.id, stats);
      result.playtime = 'updated';
    } else {
      updateGameSteamPlaytime(game.id, null);
      result.playtime = 'too_few_reviews';
    }
  } catch (error) {
    console.error(`[RefreshGame] Steam playtime for "${game.title}":`, error);
  }

  // 3. HowLongToBeat, unless the user entered or excluded HLTB by hand.
  if (game.hltbManual) {
    result.hltb = 'manual';
  } else {
    try {
      const match = await getHLTBClient().search(game.title);
      if (match && match.similarity >= HLTB_SIMILARITY_THRESHOLD) {
        updateGameHltbData(game.id, {
          hltbId: parseInt(match.id, 10) || undefined,
          hltbMain: match.gameplayMain > 0 ? match.gameplayMain : undefined,
          hltbMainExtra: match.gameplayMainExtra > 0 ? match.gameplayMainExtra : undefined,
          hltbCompletionist: match.gameplayCompletionist > 0 ? match.gameplayCompletionist : undefined,
        }, false);
        result.hltb = 'matched';
      } else {
        updateGameHltbData(game.id, {}, true);
        result.hltb = 'no_match';
      }
    } catch (error) {
      console.error(`[RefreshGame] HLTB for "${game.title}":`, error);
    }
  }

  return result;
}
