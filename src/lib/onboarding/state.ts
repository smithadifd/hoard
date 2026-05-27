/**
 * Onboarding state machine.
 *
 * Reads and writes a per-user JSON blob in the `settings` table at the key
 * `onboarding_state:${userId}`. Also derives the dashboard/wizard checklist
 * from the state + DB counts.
 */

import { getSetting, setSetting, getUserGameCount, getRatedGameCount } from '@/lib/db/queries';
import type {
  ChecklistItem,
  ChecklistResult,
  OnboardingState,
  OnboardingStatePatch,
} from './types';

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  wizardCompletedAt: null,
  steamConnectedAt: null,
  drainStartedAt: null,
  drainCompletedAt: null,
  drainMode: null,
  drainPauseReason: null,
  drainPausedUntil: null,
  checklistDismissed: false,
  triagePromptDismissedAt: null,
};

/** Threshold the checklist uses to consider the library "triaged enough". */
export const TRIAGE_DONE_THRESHOLD = 10;

function settingsKey(userId: string): string {
  return `onboarding_state:${userId}`;
}

/**
 * Coerce arbitrary parsed JSON into a valid `OnboardingState`. We accept
 * unknown fields by ignoring them and default any missing fields. This keeps
 * older serialized state forward-compatible when we add fields in Phase 2/3.
 */
function normalize(input: unknown): OnboardingState {
  if (!input || typeof input !== 'object') return { ...DEFAULT_ONBOARDING_STATE };
  const raw = input as Record<string, unknown>;
  const pickString = (k: keyof OnboardingState): string | null => {
    const v = raw[k];
    return typeof v === 'string' ? v : null;
  };
  return {
    wizardCompletedAt: pickString('wizardCompletedAt'),
    steamConnectedAt: pickString('steamConnectedAt'),
    drainStartedAt: pickString('drainStartedAt'),
    drainCompletedAt: pickString('drainCompletedAt'),
    drainMode:
      raw.drainMode === 'full' || raw.drainMode === 'lite' || raw.drainMode === 'cron-only'
        ? raw.drainMode
        : null,
    drainPauseReason:
      raw.drainPauseReason === 'rate-limit' || raw.drainPauseReason === 'manual'
        ? raw.drainPauseReason
        : null,
    drainPausedUntil: pickString('drainPausedUntil'),
    checklistDismissed: raw.checklistDismissed === true,
    triagePromptDismissedAt: pickString('triagePromptDismissedAt'),
  };
}

export function getOnboardingState(userId: string): OnboardingState {
  const raw = getSetting(settingsKey(userId));
  if (!raw) return { ...DEFAULT_ONBOARDING_STATE };
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
}

export function updateOnboardingState(
  userId: string,
  patch: OnboardingStatePatch,
): OnboardingState {
  const current = getOnboardingState(userId);
  const next: OnboardingState = { ...current, ...patch };
  setSetting(settingsKey(userId), JSON.stringify(next), 'Onboarding state machine');
  return next;
}

/**
 * Drain considered "complete enough" for the checklist when:
 *  - drainCompletedAt is set, OR
 *  - drainMode === 'cron-only' (the user opted out of the up-front drain)
 */
export function isDrainSatisfied(state: OnboardingState): boolean {
  if (state.drainCompletedAt) return true;
  if (state.drainMode === 'cron-only' && state.drainStartedAt) return true;
  return false;
}

export function computeChecklist(userId: string): ChecklistResult {
  const state = getOnboardingState(userId);
  const gameCount = getUserGameCount(userId);
  const ratedCount = getRatedGameCount(userId);

  const items: ChecklistItem[] = [
    {
      key: 'create-account',
      label: 'Create your account',
      description: 'Sign up with email and password.',
      done: true,
    },
    {
      key: 'connect-steam',
      label: 'Connect Steam',
      description: 'Add your Steam API key and Steam64 ID.',
      done: state.steamConnectedAt !== null,
      href: '/settings',
    },
    {
      key: 'sync-library',
      label: 'Sync your library',
      description: 'Pull owned games and wishlist from Steam.',
      done: gameCount > 0,
      href: '/library',
    },
    {
      key: 'run-drain',
      label: 'Run initial enrichment',
      description: 'Backfill prices, metadata, and play-time estimates.',
      done: isDrainSatisfied(state),
      href: '/settings/onboarding',
    },
    {
      key: 'triage-library',
      label: 'Triage your library',
      description: `Rate at least ${TRIAGE_DONE_THRESHOLD} games to power backlog scoring.`,
      done: ratedCount >= TRIAGE_DONE_THRESHOLD,
      href: '/library',
    },
  ];

  const allDone = items.every((i) => i.done);

  return {
    items,
    allDone,
    dismissed: state.checklistDismissed,
  };
}
