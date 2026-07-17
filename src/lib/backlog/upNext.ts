/**
 * "Up Next" — the small, opinionated queue that answers "what should I play
 * right now?" from a handful of buckets rather than an endless grid:
 *
 *   continue     — in progress, or a forgotten favourite worth returning to (#13)
 *   finish-soon  — well into it and close to the end; one push to beat it
 *   start-fresh  — a strong unplayed pick to begin
 *   drop         — invested but stalled and not worth returning to; a candidate
 *                  to consciously abandon so the backlog stops nagging
 *
 * Every surfaced pick carries ONE concrete reason. Pure and DB-free: the query
 * layer builds `UpNextCandidate`s (folding in playtime-snapshot momentum and the
 * effective-playtime basis) and hands them here for bucketing + assembly, so the
 * logic is unit-testable in isolation.
 */

import type { CompletionStatus, BacklogState } from './lifecycle';

export type UpNextBucket = 'continue' | 'finish-soon' | 'start-fresh' | 'drop';

/** Momentum classes mirror queries.classifyPlaytimeMomentum (kept local to avoid a cycle). */
export type Momentum = 'playing' | 'cooling' | 'dormant' | 'untouched';

export interface UpNextCandidate {
  gameId: number;
  title: string;
  completionStatus: CompletionStatus;
  backlogState: BacklogState | null;
  priority: number | null;
  playtimeMinutes: number;
  /** Effective playtime basis in hours (resolveEffectivePlaytime — never raw hltbMain). */
  effectiveHours: number | null;
  reviewScore: number | null;
  personalInterest: number; // 1-5
  momentum: Momentum;
  lastPlayedDaysAgo: number | null;
  /** Ranking score set by the caller — baseline heuristic in (b), learned ranker in (c). */
  score: number;
}

export interface UpNextItem {
  gameId: number;
  title: string;
  bucket: UpNextBucket;
  reason: string;
  score: number;
}

/** Below this, a game hasn't really been started (matches classifyPlaytimeMomentum). */
export const MEANINGFUL_MINUTES = 60;
/** Fraction of the effective length past which a game counts as "close to done". */
export const FINISH_SOON_MIN_RATIO = 0.6;
const WORTH_RETURN_INTEREST = 3;
const WORTH_RETURN_REVIEW = 75;

const BUCKET_ORDER: readonly UpNextBucket[] = ['continue', 'finish-soon', 'start-fresh', 'drop'];

export function completionRatio(c: Pick<UpNextCandidate, 'playtimeMinutes' | 'effectiveHours'>): number | null {
  if (c.effectiveHours == null || c.effectiveHours <= 0) return null;
  return c.playtimeMinutes / 60 / c.effectiveHours;
}

function worthReturning(c: UpNextCandidate): boolean {
  return c.personalInterest >= WORTH_RETURN_INTEREST || (c.reviewScore ?? 0) >= WORTH_RETURN_REVIEW;
}

/**
 * Assign a single bucket, or null if the game shouldn't surface at all
 * (finished, abandoned, or explicitly dropped/snoozed).
 */
export function bucketForCandidate(c: UpNextCandidate): UpNextBucket | null {
  if (c.completionStatus === 'beaten' || c.completionStatus === 'completed') return null;
  if (c.completionStatus === 'abandoned') return null;
  if (c.backlogState === 'dropped' || c.backlogState === 'snoozed') return null;

  const invested = c.playtimeMinutes >= MEANINGFUL_MINUTES;
  const ratio = completionRatio(c);

  // Close to the finish and meaningfully into it → nudge to complete.
  if (invested && ratio !== null && ratio >= FINISH_SOON_MIN_RATIO && ratio < 1) {
    return 'finish-soon';
  }

  // Actively playing right now → keep the momentum.
  if (c.completionStatus === 'playing' || c.momentum === 'playing') return 'continue';

  if (invested) {
    // A forgotten favourite: played a real amount, gone quiet, still worth it (#13).
    if (worthReturning(c)) return 'continue';
    // Invested, stalled a month+, and not worth returning to → drop candidate.
    if (c.momentum === 'dormant') return 'drop';
    // Cooling but low-value: still give it the benefit of the doubt.
    return 'continue';
  }

  // Barely touched → a fresh start.
  return 'start-fresh';
}

function hoursIn(c: UpNextCandidate): number {
  return Math.round((c.playtimeMinutes / 60) * 10) / 10;
}

function monthsAway(daysAgo: number | null): number {
  if (daysAgo == null) return 0;
  return Math.max(1, Math.round(daysAgo / 30));
}

/** The single, concrete reason a pick is being shown. */
export function explainPick(c: UpNextCandidate, bucket: UpNextBucket): string {
  const h = hoursIn(c);
  switch (bucket) {
    case 'finish-soon': {
      const remaining =
        c.effectiveHours != null ? Math.max(0.1, Math.round((c.effectiveHours - c.playtimeMinutes / 60) * 10) / 10) : null;
      return remaining != null
        ? `~${remaining}h from the finish — one session to beat it.`
        : `You're most of the way through — one session to beat it.`;
    }
    case 'continue': {
      // Key the reason off actual momentum, not the stored status: a game marked
      // 'playing' that's since gone quiet is a forgotten favourite, not active.
      if (c.momentum === 'playing') {
        return `In progress — ${h}h played. Pick up where you left off.`;
      }
      const months = monthsAway(c.lastPlayedDaysAgo);
      return `Enjoyed it once (${h}h in) but untouched ~${months} month${months === 1 ? '' : 's'} — worth another look.`;
    }
    case 'start-fresh': {
      const parts: string[] = ['Never started'];
      if (c.reviewScore != null) parts.push(`${c.reviewScore}% reviews`);
      if (c.effectiveHours != null) parts.push(`~${Math.round(c.effectiveHours)}h`);
      return `${parts.join(' · ')} — a clean pick.`;
    }
    case 'drop': {
      const months = monthsAway(c.lastPlayedDaysAgo);
      return `${h}h in but stalled ~${months} month${months === 1 ? '' : 's'} with low interest — drop it?`;
    }
  }
}

/** Shortlisted games are pinned to the top regardless of computed score. */
function shortlistBoost(c: UpNextCandidate): number {
  return c.backlogState === 'shortlisted' ? 1 : 0;
}

export interface BuildUpNextOptions {
  maxItems?: number;
}

/**
 * Assemble a diverse 3–5 item queue: seed one top-scoring pick from each
 * non-empty bucket (so the surface never collapses to a single mode), then fill
 * the remaining slots by score. Shortlisted picks always sort first.
 */
export function buildUpNextQueue(
  candidates: UpNextCandidate[],
  opts: BuildUpNextOptions = {},
): UpNextItem[] {
  const maxItems = opts.maxItems ?? 5;

  const items: UpNextItem[] = [];
  for (const c of candidates) {
    const bucket = bucketForCandidate(c);
    if (bucket == null) continue;
    items.push({ gameId: c.gameId, title: c.title, bucket, reason: explainPick(c, bucket), score: c.score });
  }

  const boostById = new Map(candidates.map((c) => [c.gameId, shortlistBoost(c)]));
  const cmp = (a: UpNextItem, b: UpNextItem): number => {
    const ba = boostById.get(a.gameId) ?? 0;
    const bb = boostById.get(b.gameId) ?? 0;
    if (ba !== bb) return bb - ba;
    if (b.score !== a.score) return b.score - a.score;
    return a.gameId - b.gameId; // stable, deterministic tiebreak
  };

  items.sort(cmp);

  // Seed one per bucket for diversity.
  const picked: UpNextItem[] = [];
  const usedIds = new Set<number>();
  for (const bucket of BUCKET_ORDER) {
    if (picked.length >= maxItems) break;
    const top = items.find((it) => it.bucket === bucket && !usedIds.has(it.gameId));
    if (top) {
      picked.push(top);
      usedIds.add(top.gameId);
    }
  }

  // Fill remaining slots by global score order.
  for (const it of items) {
    if (picked.length >= maxItems) break;
    if (usedIds.has(it.gameId)) continue;
    picked.push(it);
    usedIds.add(it.gameId);
  }

  return picked.sort(cmp);
}
