/**
 * Onboarding state machine types.
 *
 * State is stored as a JSON-encoded string in the `settings` table at the
 * key `onboarding_state:${userId}`. Read/write helpers live in `state.ts`.
 *
 * No schema change is required in Phase 1 — the settings table already
 * accepts arbitrary key/value rows.
 */

export type DrainMode = 'full' | 'lite' | 'cron-only';

export type DrainPauseReason = 'rate-limit' | 'manual';

export interface OnboardingState {
  /** When the user completed the wizard end-to-end. */
  wizardCompletedAt: string | null;
  /** When the Steam keys passed the live `GetOwnedGames` check. */
  steamConnectedAt: string | null;
  /** When the drain orchestrator started. Null = never started. */
  drainStartedAt: string | null;
  /** When the drain orchestrator finished naturally. */
  drainCompletedAt: string | null;
  /** Drain mode the user picked at step 5. */
  drainMode: DrainMode | null;
  /** Reason the drain is currently paused (set on rate-limit or manual cancel). */
  drainPauseReason: DrainPauseReason | null;
  /** ISO timestamp until which the drain is paused (24h on rate-limit). */
  drainPausedUntil: string | null;
  /** User dismissed the dashboard checklist (Phase 2 surface). */
  checklistDismissed: boolean;
  /** Last time the triage nudge was dismissed (Phase 3 surface). */
  triagePromptDismissedAt: string | null;
}

export type OnboardingStatePatch = Partial<OnboardingState>;

export type DrainStage = 'price-history' | 'metadata' | 'hltb' | 'reviews';

export interface DrainStageProgress {
  stage: DrainStage;
  processed: number;
  total: number;
  apiCalls: number;
}

export interface DrainProgress {
  /** Current stage in flight. Null when idle or finished. */
  stage: DrainStage | null;
  /** Per-stage stats keyed by stage name. */
  stages: Record<DrainStage, DrainStageProgress>;
  /** Whether the drain is currently running. */
  running: boolean;
  /** Whether the drain is paused (rate-limit or manual). */
  paused: boolean;
  /** If paused, why. */
  pauseReason: DrainPauseReason | null;
  /** If paused, until when. */
  pausedUntil: string | null;
  /** Selected drain mode. */
  mode: DrainMode | null;
  /** Cumulative count of games touched across all stages. */
  overallProcessed: number;
  /** Total games we expect to touch this run. */
  overallTotal: number;
  /** When the drain started (ISO). */
  startedAt: string | null;
  /** When the drain finished (ISO). */
  completedAt: string | null;
}

export type ChecklistKey =
  | 'create-account'
  | 'connect-steam'
  | 'sync-library'
  | 'run-drain'
  | 'triage-library';

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  description: string;
  done: boolean;
  href?: string;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  /** True when every required item is done. */
  allDone: boolean;
  /** True when the user has dismissed the checklist persistently. */
  dismissed: boolean;
}
