/**
 * The learning ranker (Queue S S9 step c). Scores an owned game for the Up Next
 * queue from purely implicit signals so the surface personalises with ZERO
 * manual triage:
 *
 *   - review quality + explicit interest (interest is neutral at its default of
 *     3, so a never-rated library doesn't collapse to a static review sort — the
 *     exact failure the audit called out)
 *   - genre/tag affinity inferred from what the user actually PLAYS
 *   - recency deltas from the playtime_snapshots series (this folds in issue #13
 *     "Forgotten Favorites"): a fresh week's gain marks a game active; a long
 *     dormancy on an invested, well-liked game resurfaces it
 *   - near-completion nudges and manual priority
 *   - dismissal cooldowns: dismiss a pick and it's suppressed, decaying back over
 *     ~a month
 *
 * Pure and DB-free: the query layer gathers the signals (incl. the snapshot
 * windows) and calls in here, so the ranking is unit-testable in isolation.
 */

import type { CompletionStatus } from './lifecycle';
import type { Momentum } from './upNext';

export interface RankingSignals {
  personalInterest: number; // 1-5
  reviewScore: number | null; // 0-100
  effectiveHours: number | null;
  playtimeMinutes: number;
  completionStatus: CompletionStatus;
  momentum: Momentum;
  /** Minutes gained over the last week, derived from the playtime_snapshots series. */
  gainedThisWeekMinutes: number;
  /** Minutes gained over the last month, derived from the playtime_snapshots series. */
  gainedThisMonthMinutes: number;
  lastPlayedDaysAgo: number | null;
  priority: number | null;
  /** 0..1 implicit affinity for this game's genres, from where the user spends hours. */
  genreAffinity: number;
  /** How many times the user has dismissed this game's recommendation. */
  dismissalCount: number;
  daysSinceLastDismissal: number | null;
}

export type RankReasonKind =
  | 'active'
  | 'forgotten-favorite'
  | 'finish-soon'
  | 'affinity'
  | 'quality'
  | 'priority'
  | 'fresh';

export interface RankResult {
  score: number;
  topReason: RankReasonKind;
  contributions: Record<string, number>;
}

const W = {
  quality: 25,
  interest: 15,
  affinity: 30,
  active: 35,
  forgotten: 28,
  finish: 22,
  priority: 6,
  dismissPenalty: 22,
} as const;

const COOLDOWN_DAYS = 30;
const ACTIVE_FULL_WEEK_HOURS = 2;
const COOLING_FULL_MONTH_HOURS = 4;
const FORGOTTEN_FULL_DAYS = 180;
const MEANINGFUL_MINUTES = 60;
/** Manual priority is clamped to this many steps so it can't dwarf the implicit
 *  signals (max contribution = W.priority * MAX_PRIORITY_STEPS, on par with the
 *  other bounded terms). */
const MAX_PRIORITY_STEPS = 5;

/** NaN-safe clamp: a NaN input (e.g. an unparseable date leaking in) collapses
 *  to the low bound rather than poisoning the whole score with NaN. */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function completionRatio(playtimeMinutes: number, effectiveHours: number | null): number | null {
  if (effectiveHours == null || effectiveHours <= 0) return null;
  return playtimeMinutes / 60 / effectiveHours;
}

/**
 * Score a single candidate. Higher = surface sooner. Also returns the dominant
 * positive signal (`topReason`) so the UI/event can explain the pick honestly.
 */
export function scoreCandidate(s: RankingSignals): RankResult {
  const invested = s.playtimeMinutes >= MEANINGFUL_MINUTES;
  const worthReturn = s.personalInterest >= 3 || (s.reviewScore ?? 0) >= 75;
  const weekHours = s.gainedThisWeekMinutes / 60;
  const monthHours = s.gainedThisMonthMinutes / 60;
  const ratio = completionRatio(s.playtimeMinutes, s.effectiveHours);

  const quality = W.quality * clamp((s.reviewScore ?? 60) / 100, 0, 1);
  const interest = W.interest * clamp((s.personalInterest - 3) / 2, -1, 1);
  const affinity = W.affinity * clamp(s.genreAffinity, 0, 1);

  // Recency (the snapshot signal). A real week's gain dominates; failing that, a
  // Steam-reported "playing" momentum still counts; failing that, a month's gain
  // gives a smaller "cooling" boost.
  let active = 0;
  if (weekHours > 0) {
    active = W.active * clamp(weekHours / ACTIVE_FULL_WEEK_HOURS, 0.25, 1);
  } else if (s.momentum === 'playing') {
    active = W.active * 0.5;
  } else if (monthHours > 0) {
    active = W.active * 0.4 * clamp(monthHours / COOLING_FULL_MONTH_HOURS, 0.25, 1);
  }

  // Forgotten favourite (#13): invested, gone dormant, still worth it. Scaled by
  // how long it's been — a longer silence is a stronger resurface. A non-finite
  // lastPlayedDaysAgo (unparseable date) falls back to the full-dormancy default
  // rather than corrupting the score.
  let forgotten = 0;
  if (s.momentum === 'dormant' && invested && worthReturn) {
    const days = Number.isFinite(s.lastPlayedDaysAgo as number)
      ? (s.lastPlayedDaysAgo as number)
      : FORGOTTEN_FULL_DAYS;
    const dormancy = clamp(days / FORGOTTEN_FULL_DAYS, 0.3, 1);
    forgotten = W.forgotten * dormancy;
  }

  const finish = ratio != null && ratio >= 0.6 && ratio < 1 ? W.finish * clamp(ratio, 0.6, 0.99) : 0;
  // Bounded so a large manual priority can't dominate the implicit signals.
  const priority = W.priority * clamp(s.priority ?? 0, 0, MAX_PRIORITY_STEPS);

  const cooldownDecay =
    s.daysSinceLastDismissal == null ? 1 : clamp(1 - s.daysSinceLastDismissal / COOLDOWN_DAYS, 0, 1);
  // `|| 0` normalises -0 (fully-lapsed penalty) to 0; real negatives pass through.
  const dismissPenalty = -W.dismissPenalty * s.dismissalCount * cooldownDecay || 0;

  const contributions: Record<string, number> = {
    quality,
    interest,
    affinity,
    active,
    forgotten,
    finish,
    priority,
    dismissPenalty,
  };

  const score =
    quality + interest + affinity + active + forgotten + finish + priority + dismissPenalty;

  // Dominant positive signal → the reason kind.
  const ranked: [RankReasonKind, number][] = [
    ['active', active],
    ['forgotten-favorite', forgotten],
    ['finish-soon', finish],
    ['affinity', affinity],
    ['quality', quality],
    ['priority', priority],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const topReason: RankReasonKind = ranked[0][1] > 0 ? ranked[0][0] : 'fresh';

  return { score, topReason, contributions };
}

/**
 * A game's implicit genre affinity: the strongest of its genres' normalised
 * play-share. Pure — the caller builds `affinityByGenre` (0..1) from actual
 * playtime across the library.
 */
export function genreAffinityForTags(genres: string[], affinityByGenre: Map<string, number>): number {
  let max = 0;
  for (const g of genres) {
    const a = affinityByGenre.get(g.toLowerCase());
    if (a != null && a > max) max = a;
  }
  return clamp(max, 0, 1);
}
