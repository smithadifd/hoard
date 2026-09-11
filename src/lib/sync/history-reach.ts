/**
 * Price-history reach — does a game's stored history plausibly reach back to
 * its launch, and is the self-heal backfill due for it?
 *
 * One rule, three callers: the page-open self-heal route, the nightly backfill
 * runner, and the alert evaluators. Pure — callers pass what they read; nothing
 * here touches the DB or the provider.
 *
 * Why this exists: `price_history_backfilled_at` used to mean "a backfill ran
 * (or we gave up)", not "history reaches launch". A transient failure could stamp
 * a game permanently, leaving it with only sync-era snapshots while every
 * automatic path treated it as done. Reach is judged against the launch date so
 * such games are retried (bounded by a cooldown) and, until healed, their
 * all-time-low claims are flagged instead of trusted.
 */

import { parseReleaseDate } from '../utils/releaseDate';

/** ITAD tracks nothing before this day; a launch earlier than it can only be reached to here. */
export const PRICE_HISTORY_EPOCH_DAY = '2012-01-01';

/**
 * Days after launch within which the earliest snapshot still counts as "reaching
 * launch". Covers the provider adding a game some weeks after release and the
 * month/quarter-precision Steam release strings ("March 2021", "Q2 2021").
 */
export const LAUNCH_REACH_TOLERANCE_DAYS = 90;

/**
 * Minimum age of `price_history_backfilled_at` before a stamped-but-short game is
 * retried. Bounds the provider cost of the self-heal to one history call per
 * short game per cooldown (both drivers share the stamp).
 */
export const BACKFILL_RETRY_COOLDOWN_DAYS = 30;

const DAY_MS = 86_400_000;

export type HistoryReachStatus =
  | 'reaches-launch'
  | 'short'
  | 'no-history'
  | 'unknown-launch';

export interface HistoryReach {
  status: HistoryReachStatus;
  /** Effective launch day (YYYY-MM-DD, floored at the provider epoch); null when unparseable. */
  launchDay: string | null;
  /** Human-readable launch as stored (Steam's free-text), for notices. */
  launchLabel: string | null;
  earliestSnapshotDate: string | null;
  /** Days the earliest snapshot falls after the effective launch (0 when at/before); null when unjudgeable. */
  shortfallDays: number | null;
}

export interface HistoryReachInput {
  releaseDate: string | null | undefined;
  earliestSnapshotDate: string | null | undefined;
}

/** UTC day number for a YYYY-MM-DD string (calendar arithmetic without timezone drift). */
function dayNumber(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function assessHistoryReach(input: HistoryReachInput): HistoryReach {
  const earliest = input.earliestSnapshotDate?.slice(0, 10) ?? null;
  const parsed = parseReleaseDate(input.releaseDate);

  if (!parsed.date) {
    return {
      status: 'unknown-launch',
      launchDay: null,
      launchLabel: null,
      earliestSnapshotDate: earliest,
      shortfallDays: null,
    };
  }

  // parseReleaseDate builds local-midnight dates; read the calendar day back the
  // same way so "Apr 15, 2021" is 2021-04-15 in every timezone.
  const rawLaunchDay = toIsoDay(parsed.date);
  const launchDay = rawLaunchDay < PRICE_HISTORY_EPOCH_DAY ? PRICE_HISTORY_EPOCH_DAY : rawLaunchDay;

  if (!earliest) {
    return { status: 'no-history', launchDay, launchLabel: parsed.label, earliestSnapshotDate: null, shortfallDays: null };
  }

  const shortfallDays = Math.max(0, dayNumber(earliest) - dayNumber(launchDay));
  return {
    status: shortfallDays > LAUNCH_REACH_TOLERANCE_DAYS ? 'short' : 'reaches-launch',
    launchDay,
    launchLabel: parsed.label,
    earliestSnapshotDate: earliest,
    shortfallDays,
  };
}

/** True when the history is too short to trust an all-time-low claim (or absent). */
export function isHistoryShort(reach: HistoryReach): boolean {
  return reach.status === 'short' || reach.status === 'no-history';
}

export type SelfHealDisposition = 'due' | 'already-backfilled' | 'cooling-down' | 'gave-up';

export interface SelfHealState {
  priceHistoryBackfilledAt: Date | null;
  priceHistoryMissCount: number;
  reach: HistoryReach;
}

/**
 * Whether the automatic backfill should run for a game right now.
 *
 * - Never stamped → due (the original once-per-game path), unless the miss count
 *   already sits at the give-up threshold (gave-up, the pre-existing no-op).
 * - Stamped and history reaches launch (or launch unknown) → already-backfilled, forever.
 * - Stamped but short → due once the stamp is older than the cooldown; otherwise
 *   cooling-down (gave-up when the miss count is at the give-up threshold — the
 *   stamp is refreshed on every miss at/over it, so a permanently failing game
 *   costs one attempt per cooldown).
 */
export function selfHealDisposition(
  state: SelfHealState,
  now: Date,
  giveUpMisses: number,
): SelfHealDisposition {
  if (state.priceHistoryBackfilledAt == null) {
    return state.priceHistoryMissCount >= giveUpMisses ? 'gave-up' : 'due';
  }
  if (!isHistoryShort(state.reach)) return 'already-backfilled';

  const ageMs = now.getTime() - state.priceHistoryBackfilledAt.getTime();
  if (ageMs >= BACKFILL_RETRY_COOLDOWN_DAYS * DAY_MS) return 'due';
  return state.priceHistoryMissCount >= giveUpMisses ? 'gave-up' : 'cooling-down';
}
