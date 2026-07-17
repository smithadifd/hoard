/**
 * Backlog lifecycle — the completion-status state machine (hoard issue #12).
 *
 * A game's `completionStatus` tracks where the user is with an owned game,
 * independent of raw playtime: unplayed → playing → beaten → completed, with
 * `abandoned` as an explicit "gave up" terminal. This module is the single,
 * DB-free source of truth for which transitions are allowed and which timestamp
 * side effects they carry (`startedAt` / `abandonedAt`), so the query layer and
 * the UI can never disagree. Pure functions only — unit-testable in isolation.
 */

export type CompletionStatus =
  | 'unplayed'
  | 'playing'
  | 'beaten'
  | 'completed'
  | 'abandoned';

export const COMPLETION_STATUSES: readonly CompletionStatus[] = [
  'unplayed',
  'playing',
  'beaten',
  'completed',
  'abandoned',
] as const;

/** Statuses that imply the game has actually been played (drives `startedAt`). */
const PLAYED_STATES: ReadonlySet<CompletionStatus> = new Set([
  'playing',
  'beaten',
  'completed',
]);

/** Statuses a game in each state may move to (self is always a valid no-op). */
const ALLOWED_TRANSITIONS: Record<CompletionStatus, readonly CompletionStatus[]> = {
  unplayed: ['playing', 'beaten', 'completed', 'abandoned'],
  playing: ['unplayed', 'beaten', 'completed', 'abandoned'],
  beaten: ['unplayed', 'playing', 'completed', 'abandoned'],
  completed: ['unplayed', 'playing', 'beaten'],
  abandoned: ['unplayed', 'playing'],
};

export function isCompletionStatus(value: unknown): value is CompletionStatus {
  return typeof value === 'string' && (COMPLETION_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether moving from `from` → `to` is a permitted lifecycle transition. A
 * status can always transition to itself (an idempotent re-set that may still
 * refresh timestamps).
 */
export function canTransition(from: CompletionStatus, to: CompletionStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface LifecycleState {
  completionStatus: CompletionStatus;
  startedAt: string | null;
  abandonedAt: string | null;
}

/**
 * Compute the persisted lifecycle fields after moving to `next`. Pure: given the
 * prior state it derives the new `startedAt` / `abandonedAt` deterministically.
 *
 * - Entering a played state (playing/beaten/completed) stamps `startedAt` once
 *   (set-if-null) — so marking a long-finished game 'beaten' still records that
 *   it was played, and re-entering 'playing' keeps the original start date.
 * - Entering 'abandoned' stamps `abandonedAt` (set-if-null, preserving the first
 *   abandon date); leaving 'abandoned' clears it.
 * - Resetting to 'unplayed' clears both — the game is back to a clean slate.
 */
export function applyCompletionTransition(
  prev: LifecycleState,
  next: CompletionStatus,
  now: string = new Date().toISOString(),
): LifecycleState {
  if (next === 'unplayed') {
    return { completionStatus: 'unplayed', startedAt: null, abandonedAt: null };
  }

  const startedAt =
    PLAYED_STATES.has(next) && prev.startedAt == null ? now : prev.startedAt ?? null;

  const abandonedAt =
    next === 'abandoned' ? prev.abandonedAt ?? now : null;

  return { completionStatus: next, startedAt, abandonedAt };
}

/**
 * Auto-detection hint (issue #12 "nice-to-have"). Suggests a status from
 * observed play signals but NEVER decides — the honesty non-goal means the user
 * confirms. Only nudges from `unplayed`/`playing`; terminal user decisions
 * (beaten/completed/abandoned) are left alone.
 *
 * - played past its effective main length → 'beaten'
 * - some playtime and touched within the last fortnight → 'playing'
 * - otherwise no suggestion (returns null)
 */
export function suggestCompletionStatus(input: {
  current: CompletionStatus;
  playtimeMinutes: number;
  effectiveHours: number | null;
  lastPlayedDaysAgo: number | null;
}): CompletionStatus | null {
  if (input.current !== 'unplayed' && input.current !== 'playing') return null;
  if (input.playtimeMinutes <= 0) return null;

  const playedHours = input.playtimeMinutes / 60;
  if (input.effectiveHours != null && input.effectiveHours > 0 && playedHours >= input.effectiveHours) {
    return 'beaten';
  }

  const recentlyPlayed = input.lastPlayedDaysAgo != null && input.lastPlayedDaysAgo <= 14;
  if (recentlyPlayed && input.current !== 'playing') return 'playing';

  return null;
}

/** Explicit Up-Next queue intents (overrides the derived bucket). */
export type BacklogState = 'shortlisted' | 'snoozed' | 'dropped';

export const BACKLOG_STATES: readonly BacklogState[] = ['shortlisted', 'snoozed', 'dropped'] as const;

export function isBacklogState(value: unknown): value is BacklogState {
  return typeof value === 'string' && (BACKLOG_STATES as readonly string[]).includes(value);
}
