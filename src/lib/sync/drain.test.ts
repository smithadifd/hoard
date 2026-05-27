import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OnboardingState } from '@/lib/onboarding/types';

vi.mock('@/lib/demo', () => ({
  isDemoMode: vi.fn().mockReturnValue(false),
}));

vi.mock('./price-history-backfill', () => ({
  primePriceHistory: vi.fn(),
}));

vi.mock('./metadata', () => ({
  refreshMetadata: vi.fn(),
}));

vi.mock('./hltb', () => ({
  syncHltb: vi.fn(),
}));

vi.mock('./reviews', () => ({
  syncReviews: vi.fn(),
}));

// In-memory state store so updateOnboardingState writes round-trip back to
// getOnboardingState reads. Mirrors production behavior without DB.
let mockState: OnboardingState = makeDefaultState();
function makeDefaultState(): OnboardingState {
  return {
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
}

vi.mock('@/lib/onboarding/state', () => ({
  updateOnboardingState: vi.fn((_userId: string, patch: Partial<OnboardingState>) => {
    mockState = { ...mockState, ...patch };
    return mockState;
  }),
  getOnboardingState: vi.fn(() => mockState),
}));

import {
  startDrain,
  cancelDrain,
  isDraining,
  isRateLimit,
  getDrainProgress,
  _drainCompletionForTests,
} from './drain';
import { primePriceHistory } from './price-history-backfill';
import { refreshMetadata } from './metadata';
import { syncHltb } from './hltb';
import { syncReviews } from './reviews';
import { updateOnboardingState } from '@/lib/onboarding/state';
import { isDemoMode } from '@/lib/demo';
import type { SyncResult } from './types';

const mockPrime = vi.mocked(primePriceHistory);
const mockMetadata = vi.mocked(refreshMetadata);
const mockHltb = vi.mocked(syncHltb);
const mockReviews = vi.mocked(syncReviews);
const mockUpdate = vi.mocked(updateOnboardingState);
const mockDemo = vi.mocked(isDemoMode);

function makeResult(stats: Partial<SyncResult['stats']>): SyncResult {
  return {
    syncLogId: 1,
    stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, ...stats },
  };
}

function emptyResult(): SyncResult {
  return makeResult({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
}

async function waitForDrain(): Promise<void> {
  const p = _drainCompletionForTests();
  if (p) await p;
}

describe('isRateLimit', () => {
  it('matches HTTP 429 messages', () => {
    expect(isRateLimit(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('matches rate-limit prose', () => {
    expect(isRateLimit(new Error('You have been rate-limited'))).toBe(true);
    expect(isRateLimit(new Error('too many requests'))).toBe(true);
    expect(isRateLimit('rate limit exceeded')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRateLimit(new Error('connection refused'))).toBe(false);
    expect(isRateLimit(null)).toBe(false);
    expect(isRateLimit(undefined)).toBe(false);
  });
});

describe('startDrain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDemo.mockReturnValue(false);
    mockState = makeDefaultState();
  });

  it('refuses when demo mode is on', () => {
    mockDemo.mockReturnValue(true);
    const result = startDrain({ mode: 'lite', userId: 'user-1' });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('demo-mode');
  });

  it('stamps state and exits immediately for cron-only mode', () => {
    const result = startDrain({ mode: 'cron-only', userId: 'user-1' });
    expect(result.started).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        drainMode: 'cron-only',
        drainStartedAt: expect.any(String),
        drainCompletedAt: expect.any(String),
      }),
    );
    expect(isDraining()).toBe(false);
  });

  it('refuses a second concurrent drain', async () => {
    let primeCalled: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      primeCalled = resolve;
    });
    mockPrime.mockImplementation((_progress, signal) => {
      primeCalled();
      return new Promise<SyncResult>((resolve) => {
        signal?.addEventListener('abort', () => resolve(emptyResult()));
      });
    });
    mockMetadata.mockResolvedValue(emptyResult());

    const first = startDrain({ mode: 'lite', userId: 'user-1' });
    expect(first.started).toBe(true);
    await inFlight;

    const second = startDrain({ mode: 'lite', userId: 'user-1' });
    expect(second.started).toBe(false);
    expect(second.reason).toBe('already-running');

    cancelDrain();
    await waitForDrain();
  });

  it('runs lite mode stages in order (price-history, metadata) and stamps drainCompletedAt', async () => {
    mockPrime.mockResolvedValueOnce(makeResult({ attempted: 5, succeeded: 5 }))
            .mockResolvedValueOnce(emptyResult());
    mockMetadata.mockResolvedValueOnce(makeResult({ attempted: 3, succeeded: 3 }))
                 .mockResolvedValueOnce(emptyResult());

    const result = startDrain({ mode: 'lite', userId: 'user-1' });
    expect(result.started).toBe(true);

    await waitForDrain();

    expect(mockPrime).toHaveBeenCalled();
    expect(mockMetadata).toHaveBeenCalled();
    expect(mockHltb).not.toHaveBeenCalled();
    expect(mockReviews).not.toHaveBeenCalled();

    const completeCall = mockUpdate.mock.calls.find(
      ([, patch]) => patch.drainCompletedAt !== undefined && patch.drainCompletedAt !== null,
    );
    expect(completeCall).toBeDefined();
    expect(isDraining()).toBe(false);
  });

  it('runs full mode stages in order (price-history, metadata, hltb, reviews)', async () => {
    const seenOrder: string[] = [];
    mockPrime.mockImplementation(async () => {
      seenOrder.push('price-history');
      return emptyResult();
    });
    mockMetadata.mockImplementation(async () => {
      seenOrder.push('metadata');
      return emptyResult();
    });
    mockHltb.mockImplementation(async () => {
      seenOrder.push('hltb');
      return emptyResult();
    });
    mockReviews.mockImplementation(async () => {
      seenOrder.push('reviews');
      return emptyResult();
    });

    startDrain({ mode: 'full', userId: 'user-1' });
    await waitForDrain();

    expect(seenOrder).toEqual(['price-history', 'metadata', 'hltb', 'reviews']);
  });

  it('halts on rate-limit and pauses the drain for 24h', async () => {
    mockPrime.mockResolvedValueOnce(makeResult({ attempted: 2, succeeded: 2 }))
             .mockResolvedValueOnce(emptyResult());
    // Metadata throws a 429-shaped error
    mockMetadata.mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'));

    startDrain({ mode: 'lite', userId: 'user-1' });
    await waitForDrain();

    const pauseCall = mockUpdate.mock.calls.find(
      ([, patch]) => patch.drainPauseReason === 'rate-limit',
    );
    expect(pauseCall).toBeDefined();
    expect(pauseCall![1].drainPausedUntil).toBeTruthy();

    // Reviews should never run because metadata halted the drain
    expect(mockHltb).not.toHaveBeenCalled();
    expect(mockReviews).not.toHaveBeenCalled();

    // No drainCompletedAt was stamped
    const completeCall = mockUpdate.mock.calls.find(
      ([, patch]) => patch.drainCompletedAt !== undefined && patch.drainCompletedAt !== null,
    );
    expect(completeCall).toBeUndefined();
    expect(isDraining()).toBe(false);
  });

  it('halts on high failure-ratio signal (probable upstream rate-limit)', async () => {
    // 20 attempts, 18 failed = 90% failure, above the 80% floor
    mockPrime.mockResolvedValueOnce(makeResult({ attempted: 20, failed: 18, succeeded: 2 }));
    mockMetadata.mockResolvedValue(emptyResult());

    startDrain({ mode: 'lite', userId: 'user-1' });
    await waitForDrain();

    const pauseCall = mockUpdate.mock.calls.find(
      ([, patch]) => patch.drainPauseReason === 'rate-limit',
    );
    expect(pauseCall).toBeDefined();
    expect(mockMetadata).not.toHaveBeenCalled();
  });

  it('honours cancelDrain by stamping manual pause reason', async () => {
    let resolvePrime: (r: SyncResult) => void = () => {};
    let primeCalled: () => void = () => {};
    const primeInFlight = new Promise<void>((resolve) => {
      primeCalled = resolve;
    });

    mockPrime.mockImplementation(() => {
      primeCalled();
      return new Promise<SyncResult>((resolve) => {
        resolvePrime = resolve;
      });
    });
    mockMetadata.mockResolvedValue(emptyResult());

    startDrain({ mode: 'lite', userId: 'user-1' });
    await primeInFlight;

    expect(cancelDrain()).toBe(true);
    // Resolve the in-flight stage so the loop can continue and notice the abort
    resolvePrime(makeResult({ attempted: 1, succeeded: 1 }));
    await waitForDrain();

    const cancelCall = mockUpdate.mock.calls.find(
      ([, patch]) => patch.drainPauseReason === 'manual',
    );
    expect(cancelCall).toBeDefined();
    expect(isDraining()).toBe(false);
  });

  it('exposes per-stage progress via getDrainProgress', async () => {
    let resolvePrime: (r: SyncResult) => void = () => {};
    let primeProgressEmitted: () => void = () => {};
    const primeStarted = new Promise<void>((resolve) => {
      primeProgressEmitted = resolve;
    });

    mockPrime.mockImplementation((onProgress) => {
      onProgress?.(5, 100, { gameName: 'Test', status: 'processing' });
      primeProgressEmitted();
      return new Promise<SyncResult>((resolve) => {
        resolvePrime = resolve;
      });
    });
    mockMetadata.mockResolvedValue(emptyResult());

    startDrain({ mode: 'lite', userId: 'user-1' });
    await primeStarted;

    const progress = getDrainProgress();
    expect(progress.running).toBe(true);
    expect(progress.stage).toBe('price-history');
    expect(progress.stages['price-history'].processed).toBeGreaterThan(0);

    cancelDrain();
    resolvePrime(emptyResult());
    await waitForDrain();
  });
});
