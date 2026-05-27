/**
 * Onboarding Drain Orchestrator
 *
 * Runs the enrichment pipeline in stages so a brand-new user has charts and
 * scores within minutes instead of waiting nights for cron to catch up.
 *
 * Stages (in order):
 *   1. price-history (primePriceHistory)  — full library, ~1s per game (ITAD)
 *   2. metadata      (refreshMetadata)    — full library, ~3s per game (Steam)
 *   3. hltb          (syncHltb)           — capped at 300 games (HLTB scraper)
 *   4. reviews       (syncReviews)        — full library, ~3s per game (Steam)
 *
 * Drain modes:
 *   - 'full'      : all 4 stages
 *   - 'lite'      : price-history + metadata only
 *   - 'cron-only' : drain nothing — the wizard step just stamps state and exits
 *
 * Concurrency: module-level guard. Cron callbacks gate on `isDraining()` so
 * scheduled tasks don't compete for the same APIs while the drain runs.
 *
 * Rate-limit handling: any stage that catches a 429-shaped error (or hits a
 * failure-rate floor) flips the drain into a 24h pause. The wizard banner
 * surfaces the pause; cron resumes the queue the next night.
 */

import { isDemoMode } from '@/lib/demo';
import { primePriceHistory } from './price-history-backfill';
import { refreshMetadata } from './metadata';
import { syncHltb } from './hltb';
import { syncReviews } from './reviews';
import { updateOnboardingState, getOnboardingState } from '@/lib/onboarding/state';
import type {
  DrainMode,
  DrainProgress,
  DrainStage,
  DrainStageProgress,
} from '@/lib/onboarding/types';
import type { SyncResult } from './types';

const HLTB_CAP = 300;
const PAUSE_DURATION_MS = 24 * 60 * 60 * 1000;
const FAILURE_FLOOR_RATIO = 0.8;
const FAILURE_FLOOR_MIN_ATTEMPTS = 10;

// API-call budget per stage. Each stage hard-stops once the cumulative
// `attempted` count crosses the budget (cheap proxy — exact counts live in
// sync_log.api_calls). Values mirror the plan: keep the drain inside one
// quota window per upstream API.
const BUDGETS: Record<DrainStage, number> = {
  'price-history': 3000,
  metadata: 750, // ~1500 Steam calls (2 per game)
  hltb: HLTB_CAP,
  reviews: 500, // ~1000 Steam calls (2 per game)
};

const STAGES_BY_MODE: Record<DrainMode, DrainStage[]> = {
  full: ['price-history', 'metadata', 'hltb', 'reviews'],
  lite: ['price-history', 'metadata'],
  'cron-only': [],
};

// Module-level state. The orchestrator is single-instance — Hoard runs as one
// Node process per deployment.
let isRunning = false;
let abortController: AbortController | null = null;
let currentMode: DrainMode | null = null;
let currentStage: DrainStage | null = null;
let currentUserId: string | null = null;
let stageStats: Record<DrainStage, DrainStageProgress> = makeEmptyStageStats();
// Exposed for tests: resolves when the background drain finishes, regardless
// of outcome (complete, paused, cancelled). Production callers should not
// rely on this — use polling via `getDrainProgress()` instead.
let drainCompletion: Promise<void> | null = null;

function makeEmptyStageStats(): Record<DrainStage, DrainStageProgress> {
  return {
    'price-history': { stage: 'price-history', processed: 0, total: 0, apiCalls: 0 },
    metadata: { stage: 'metadata', processed: 0, total: 0, apiCalls: 0 },
    hltb: { stage: 'hltb', processed: 0, total: 0, apiCalls: 0 },
    reviews: { stage: 'reviews', processed: 0, total: 0, apiCalls: 0 },
  };
}

export function isDraining(): boolean {
  return isRunning;
}

/**
 * 429 detection. Sync functions catch most upstream errors themselves and
 * stamp `failed++`, so this matches three signals:
 *   - HTTP 429 status text bubbling up via a thrown Error
 *   - "too many requests" / "rate limit" prose from a scraper
 *   - Steam's prose 429s ("api rate-limit exceeded")
 */
export function isRateLimit(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|too many requests|rate.?limit/i.test(msg);
}

type SyncFn = (
  onProgress?: (processed: number, total: number, ctx?: { gameName?: string; status?: string }) => void,
  signal?: AbortSignal,
  userId?: string,
) => Promise<SyncResult>;

const STAGE_SYNC_FNS: Record<DrainStage, SyncFn> = {
  'price-history': primePriceHistory,
  metadata: refreshMetadata,
  // syncHltb/syncReviews don't take a userId — they enrich the shared queue
  hltb: (onProgress, signal) => syncHltb(onProgress, signal),
  reviews: (onProgress, signal) => syncReviews(onProgress, signal),
};

interface StageRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  rateLimited: boolean;
  error?: Error;
}

async function runStage(
  stage: DrainStage,
  userId: string,
  signal: AbortSignal,
): Promise<StageRunResult> {
  const budget = BUDGETS[stage];
  let cumAttempted = 0;
  let cumSucceeded = 0;
  let cumFailed = 0;
  const syncFn = STAGE_SYNC_FNS[stage];

  // For HLTB we cap by attempted count; other stages cap by budget too, but
  // since each underlying syncFn caps each call at its own BATCH_SIZE (100),
  // we just loop until the queue is empty or we hit the budget.
  while (cumAttempted < budget) {
    if (signal.aborted) {
      return {
        attempted: cumAttempted,
        succeeded: cumSucceeded,
        failed: cumFailed,
        cancelled: true,
        rateLimited: false,
      };
    }

    try {
      const result = await syncFn(
        (processed, total) => {
          stageStats[stage] = {
            stage,
            processed: cumAttempted + processed,
            total: Math.max(total + cumAttempted, stageStats[stage].total),
            apiCalls: stageStats[stage].apiCalls,
          };
        },
        signal,
        userId,
      );

      cumAttempted += result.stats.attempted;
      cumSucceeded += result.stats.succeeded;
      cumFailed += result.stats.failed;

      stageStats[stage] = {
        stage,
        processed: cumAttempted,
        total: Math.max(stageStats[stage].total, cumAttempted),
        apiCalls: stageStats[stage].apiCalls + result.stats.attempted, // rough proxy
      };

      // Queue exhausted: nothing left to process this stage.
      if (result.stats.attempted === 0) {
        return {
          attempted: cumAttempted,
          succeeded: cumSucceeded,
          failed: cumFailed,
          cancelled: false,
          rateLimited: false,
        };
      }

      // Probable rate-limit signal: enough attempts to be confident, almost
      // all failing. Upstream sync functions swallow per-game errors so they
      // never throw 429s at us — we infer it from the failure ratio.
      if (
        result.stats.attempted >= FAILURE_FLOOR_MIN_ATTEMPTS &&
        result.stats.failed / result.stats.attempted >= FAILURE_FLOOR_RATIO
      ) {
        return {
          attempted: cumAttempted,
          succeeded: cumSucceeded,
          failed: cumFailed,
          cancelled: false,
          rateLimited: true,
        };
      }
    } catch (err) {
      if (isRateLimit(err)) {
        return {
          attempted: cumAttempted,
          succeeded: cumSucceeded,
          failed: cumFailed,
          cancelled: false,
          rateLimited: true,
        };
      }
      const wrapped = err instanceof Error ? err : new Error(String(err));
      return {
        attempted: cumAttempted,
        succeeded: cumSucceeded,
        failed: cumFailed,
        cancelled: false,
        rateLimited: false,
        error: wrapped,
      };
    }
  }

  return {
    attempted: cumAttempted,
    succeeded: cumSucceeded,
    failed: cumFailed,
    cancelled: false,
    rateLimited: false,
  };
}

export interface StartDrainOptions {
  mode: DrainMode;
  userId: string;
}

export interface StartDrainResult {
  started: boolean;
  reason?: 'already-running' | 'demo-mode';
}

/**
 * Kick off the drain in the background. Returns immediately — the caller
 * polls `getDrainProgress()` for status. Throws if the orchestrator is
 * already running.
 */
export function startDrain(options: StartDrainOptions): StartDrainResult {
  if (isDemoMode()) {
    return { started: false, reason: 'demo-mode' };
  }
  if (isRunning) {
    return { started: false, reason: 'already-running' };
  }

  // cron-only: stamp state and exit. The wizard step does the same thing
  // server-side; we keep this here so the API path stays uniform.
  if (options.mode === 'cron-only') {
    const now = new Date().toISOString();
    updateOnboardingState(options.userId, {
      drainMode: 'cron-only',
      drainStartedAt: now,
      drainCompletedAt: now,
      drainPauseReason: null,
      drainPausedUntil: null,
    });
    return { started: true };
  }

  isRunning = true;
  abortController = new AbortController();
  currentMode = options.mode;
  currentUserId = options.userId;
  currentStage = null;
  stageStats = makeEmptyStageStats();

  const startedAt = new Date().toISOString();
  updateOnboardingState(options.userId, {
    drainMode: options.mode,
    drainStartedAt: startedAt,
    drainCompletedAt: null,
    drainPauseReason: null,
    drainPausedUntil: null,
  });

  drainCompletion = runDrain(options.mode, options.userId, abortController.signal).catch((err) => {
    console.error('[Drain] Unexpected orchestrator error:', err);
  });

  return { started: true };
}

/**
 * Test-only helper: returns the in-flight drain promise so a test can await
 * a deterministic completion. Production code should not use this.
 */
export function _drainCompletionForTests(): Promise<void> | null {
  return drainCompletion;
}

async function runDrain(
  mode: DrainMode,
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const stages = STAGES_BY_MODE[mode];
  console.log(`[Drain] Starting ${mode} drain for ${userId} — ${stages.length} stages`);

  try {
    for (const stage of stages) {
      currentStage = stage;
      console.log(`[Drain] Stage: ${stage}`);
      const result = await runStage(stage, userId, signal);
      console.log(
        `[Drain]   ${stage} done: attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} cancelled=${result.cancelled} rateLimited=${result.rateLimited}`,
      );

      if (result.cancelled) {
        const now = new Date().toISOString();
        updateOnboardingState(userId, {
          drainPauseReason: 'manual',
          drainPausedUntil: null,
          drainCompletedAt: null,
          drainStartedAt: getOnboardingState(userId).drainStartedAt ?? now,
        });
        return;
      }

      if (result.rateLimited) {
        const pausedUntil = new Date(Date.now() + PAUSE_DURATION_MS).toISOString();
        updateOnboardingState(userId, {
          drainPauseReason: 'rate-limit',
          drainPausedUntil: pausedUntil,
        });
        // TODO(Phase 2): createNotification(userId, 'drain-paused', { stage, pausedUntil })
        console.warn(`[Drain] Stage ${stage} rate-limited — paused until ${pausedUntil}`);
        return;
      }
    }

    const completedAt = new Date().toISOString();
    updateOnboardingState(userId, {
      drainCompletedAt: completedAt,
      drainPauseReason: null,
      drainPausedUntil: null,
    });
    // TODO(Phase 2): createNotification(userId, 'drain-complete')
    // TODO(Phase 3): fire Discord milestone for drain-complete
    console.log(`[Drain] All stages complete for ${userId}`);
  } finally {
    isRunning = false;
    abortController = null;
    currentStage = null;
    currentMode = null;
    currentUserId = null;
  }
}

/**
 * Stop the in-flight drain. Stamps `drainPauseReason: 'manual'` so the wizard
 * banner reflects the cancellation. Returns false if no drain was running.
 */
export function cancelDrain(): boolean {
  if (!isRunning || !abortController) return false;
  abortController.abort();
  return true;
}

export function getDrainProgress(): DrainProgress {
  const state = currentUserId ? getOnboardingState(currentUserId) : null;
  const overallProcessed = Object.values(stageStats).reduce((sum, s) => sum + s.processed, 0);
  const overallTotal = Object.values(stageStats).reduce((sum, s) => sum + s.total, 0);

  return {
    stage: currentStage,
    stages: { ...stageStats },
    running: isRunning,
    paused: state?.drainPauseReason !== null && state?.drainPauseReason !== undefined,
    pauseReason: state?.drainPauseReason ?? null,
    pausedUntil: state?.drainPausedUntil ?? null,
    mode: currentMode ?? state?.drainMode ?? null,
    overallProcessed,
    overallTotal,
    startedAt: state?.drainStartedAt ?? null,
    completedAt: state?.drainCompletedAt ?? null,
  };
}

/**
 * Returns a snapshot for a specific user, even when the orchestrator isn't
 * running (e.g. after a server restart). Used by the wizard's progress
 * polling so the UI keeps rendering meaningful state.
 */
export function getDrainProgressForUser(userId: string): DrainProgress {
  if (currentUserId === userId) return getDrainProgress();

  const state = getOnboardingState(userId);
  return {
    stage: null,
    stages: makeEmptyStageStats(),
    running: false,
    paused: state.drainPauseReason !== null,
    pauseReason: state.drainPauseReason,
    pausedUntil: state.drainPausedUntil,
    mode: state.drainMode,
    overallProcessed: 0,
    overallTotal: 0,
    startedAt: state.drainStartedAt,
    completedAt: state.drainCompletedAt,
  };
}
