/**
 * When Steam-derived data is due for another look.
 *
 * Steam data on a new game moves fast: the review count climbs from zero in the
 * first days after launch, and the reviewer-playtime median only becomes
 * meaningful once enough players have written reviews. Pre-release attempts
 * find nothing at all. These rules keep young games fresh and never let a
 * pre-launch miss turn into a permanent give-up.
 *
 * Pure and client-safe: callers pass `now`, and nothing here touches the DB.
 */

import { parseReleaseDate } from '@/lib/utils/releaseDate';
import { STEAM_PLAYTIME_GIVE_UP_MISSES } from '@/lib/playtimeSource';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A game counts as "young" for this many days after launch. */
export const YOUNG_GAME_WINDOW_DAYS = 90;

/** Young games get their reviewer-playtime median re-sampled this often. */
export const STEAM_PLAYTIME_YOUNG_REFRESH_DAYS = 7;
/** Established games get their median re-sampled this often. */
export const STEAM_PLAYTIME_REFRESH_DAYS = 90;
/** Minimum spacing between attempts after a miss, while under the give-up cap. */
export const STEAM_PLAYTIME_MISS_RETRY_DAYS = 2;
/** Spacing between attempts once the give-up cap is reached. Never permanent. */
export const STEAM_PLAYTIME_GAVE_UP_RETRY_DAYS = 30;

/** Young games with no HLTB match are retried this often, whatever their miss count. */
export const HLTB_YOUNG_RETRY_DAYS = 7;

/** Young games jump the metadata-refresh queue once their data is this old. */
export const METADATA_YOUNG_REFRESH_DAYS = 1;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / DAY_MS;
}

/**
 * Days since the game launched, or null when the release date is unknown or too
 * vague (quarter/year only) to anchor a window. Negative for future dates.
 */
export function daysSinceRelease(releaseDate: string | null | undefined, now: Date): number | null {
  const parsed = parseReleaseDate(releaseDate);
  if (!parsed.date || (parsed.precision !== 'day' && parsed.precision !== 'month')) return null;
  return (now.getTime() - parsed.date.getTime()) / DAY_MS;
}

/** Released (per Steam), and launched within {@link YOUNG_GAME_WINDOW_DAYS}. */
export function isYoungGame(
  game: { isReleased: boolean | null | undefined; releaseDate: string | null | undefined },
  now: Date,
): boolean {
  if (game.isReleased === false) return false;
  const days = daysSinceRelease(game.releaseDate, now);
  return days !== null && days >= 0 && days <= YOUNG_GAME_WINDOW_DAYS;
}

export interface SteamPlaytimeState {
  isReleased: boolean | null | undefined;
  releaseDate: string | null | undefined;
  steamPlaytimeMedian: number | null | undefined;
  steamPlaytimeUpdatedAt: string | null | undefined;
  steamPlaytimeMissCount: number | null | undefined;
}

/**
 * Whether the reviewer-playtime median should be (re)sampled now.
 *
 * - Unreleased games are never sampled: there are no reviews to sample, and a
 *   miss then must not count against the game after launch.
 * - No median yet: retry every {@link STEAM_PLAYTIME_MISS_RETRY_DAYS} days while
 *   under the give-up cap, then every {@link STEAM_PLAYTIME_GAVE_UP_RETRY_DAYS}
 *   days. A small game can cross the sample threshold months after launch.
 * - Median stored: re-sample weekly while the game is young, then every
 *   {@link STEAM_PLAYTIME_REFRESH_DAYS} days.
 */
export function isSteamPlaytimeDue(game: SteamPlaytimeState, now: Date): boolean {
  if (game.isReleased === false) return false;
  const age = daysSince(game.steamPlaytimeUpdatedAt, now);
  if (age === null) return true;

  const hasMedian = game.steamPlaytimeMedian !== null && game.steamPlaytimeMedian !== undefined;
  if (hasMedian) {
    const interval = isYoungGame(game, now) ? STEAM_PLAYTIME_YOUNG_REFRESH_DAYS : STEAM_PLAYTIME_REFRESH_DAYS;
    return age >= interval;
  }

  const gaveUp = (game.steamPlaytimeMissCount ?? 0) >= STEAM_PLAYTIME_GIVE_UP_MISSES;
  return age >= (gaveUp ? STEAM_PLAYTIME_GAVE_UP_RETRY_DAYS : STEAM_PLAYTIME_MISS_RETRY_DAYS);
}

/**
 * Whether a young game with no HLTB match is due a retry outside the normal
 * miss-count backoff. HLTB entries for a new game often appear weeks after
 * launch, long after the backoff has stretched to 90 days.
 */
export function isHltbYoungRetryDue(
  game: {
    isReleased: boolean | null | undefined;
    releaseDate: string | null | undefined;
    hltbId: number | null | undefined;
    hltbLastUpdated: string | null | undefined;
  },
  now: Date,
): boolean {
  if (game.hltbId !== null && game.hltbId !== undefined) return false;
  if (!isYoungGame(game, now)) return false;
  const age = daysSince(game.hltbLastUpdated, now);
  return age === null || age >= HLTB_YOUNG_RETRY_DAYS;
}

/**
 * Order metadata-refresh candidates: young games whose data is over a day old
 * go first (their review counts move daily), then everything else in LRU order.
 * Input must already be in LRU order; the sort is stable within each group.
 */
export function prioritizeMetadataRefresh<
  T extends { isReleased: boolean | null; releaseDate: string | null; metadataLastUpdated: string | null },
>(rows: T[], now: Date, batchSize: number): T[] {
  const urgent: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    const age = daysSince(row.metadataLastUpdated, now);
    const stale = age === null || age >= METADATA_YOUNG_REFRESH_DAYS;
    (stale && isYoungGame(row, now) ? urgent : rest).push(row);
  }
  return [...urgent, ...rest].slice(0, batchSize);
}
