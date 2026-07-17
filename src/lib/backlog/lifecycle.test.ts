import { describe, it, expect } from 'vitest';
import {
  COMPLETION_STATUSES,
  canTransition,
  applyCompletionTransition,
  suggestCompletionStatus,
  isCompletionStatus,
  isBacklogState,
  type LifecycleState,
} from './lifecycle';

const NOW = '2026-07-17T12:00:00.000Z';
const EARLIER = '2026-01-01T00:00:00.000Z';

function state(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return {
    completionStatus: overrides.completionStatus ?? 'unplayed',
    startedAt: overrides.startedAt ?? null,
    abandonedAt: overrides.abandonedAt ?? null,
  };
}

describe('isCompletionStatus / isBacklogState', () => {
  it('accepts the five lifecycle values and rejects junk', () => {
    for (const s of COMPLETION_STATUSES) expect(isCompletionStatus(s)).toBe(true);
    expect(isCompletionStatus('done')).toBe(false);
    expect(isCompletionStatus(null)).toBe(false);
    expect(isCompletionStatus(3)).toBe(false);
  });

  it('validates backlog-state overrides', () => {
    expect(isBacklogState('shortlisted')).toBe(true);
    expect(isBacklogState('snoozed')).toBe(true);
    expect(isBacklogState('dropped')).toBe(true);
    expect(isBacklogState('abandoned')).toBe(false); // that's a completion status
    expect(isBacklogState(undefined)).toBe(false);
  });
});

describe('canTransition', () => {
  it('always allows a no-op self transition', () => {
    for (const s of COMPLETION_STATUSES) expect(canTransition(s, s)).toBe(true);
  });

  it('allows the sensible forward flow', () => {
    expect(canTransition('unplayed', 'playing')).toBe(true);
    expect(canTransition('playing', 'beaten')).toBe(true);
    expect(canTransition('beaten', 'completed')).toBe(true);
    expect(canTransition('playing', 'abandoned')).toBe(true);
    expect(canTransition('abandoned', 'playing')).toBe(true); // picked back up
  });

  it('rejects nonsensical jumps', () => {
    expect(canTransition('completed', 'abandoned')).toBe(false); // you finished it
    expect(canTransition('abandoned', 'completed')).toBe(false);
    expect(canTransition('abandoned', 'beaten')).toBe(false);
  });
});

describe('applyCompletionTransition', () => {
  it('stamps startedAt on first entry to a played state', () => {
    const next = applyCompletionTransition(state(), 'playing', NOW);
    expect(next).toEqual({ completionStatus: 'playing', startedAt: NOW, abandonedAt: null });
  });

  it('preserves the original startedAt when re-entering playing', () => {
    const next = applyCompletionTransition(
      state({ completionStatus: 'beaten', startedAt: EARLIER }),
      'playing',
      NOW,
    );
    expect(next.startedAt).toBe(EARLIER);
  });

  it('stamps startedAt even when jumping straight to beaten', () => {
    const next = applyCompletionTransition(state(), 'beaten', NOW);
    expect(next.startedAt).toBe(NOW);
    expect(next.completionStatus).toBe('beaten');
  });

  it('stamps abandonedAt on entry and clears it on exit', () => {
    const abandoned = applyCompletionTransition(
      state({ completionStatus: 'playing', startedAt: EARLIER }),
      'abandoned',
      NOW,
    );
    expect(abandoned).toEqual({ completionStatus: 'abandoned', startedAt: EARLIER, abandonedAt: NOW });

    const revived = applyCompletionTransition(abandoned, 'playing', '2026-08-01T00:00:00.000Z');
    expect(revived.abandonedAt).toBeNull();
    expect(revived.startedAt).toBe(EARLIER);
  });

  it('preserves the first abandon date on a re-abandon', () => {
    const first = state({ completionStatus: 'abandoned', startedAt: EARLIER, abandonedAt: EARLIER });
    const next = applyCompletionTransition(first, 'abandoned', NOW);
    expect(next.abandonedAt).toBe(EARLIER);
  });

  it('resetting to unplayed wipes both timestamps', () => {
    const next = applyCompletionTransition(
      state({ completionStatus: 'completed', startedAt: EARLIER }),
      'unplayed',
      NOW,
    );
    expect(next).toEqual({ completionStatus: 'unplayed', startedAt: null, abandonedAt: null });
  });
});

describe('suggestCompletionStatus', () => {
  it('suggests beaten once playtime passes the effective main length', () => {
    expect(
      suggestCompletionStatus({
        current: 'unplayed',
        playtimeMinutes: 12 * 60,
        effectiveHours: 10,
        lastPlayedDaysAgo: 3,
      }),
    ).toBe('beaten');
  });

  it('suggests playing for recent, sub-length playtime', () => {
    expect(
      suggestCompletionStatus({
        current: 'unplayed',
        playtimeMinutes: 90,
        effectiveHours: 10,
        lastPlayedDaysAgo: 2,
      }),
    ).toBe('playing');
  });

  it('never suggests for a never-touched game', () => {
    expect(
      suggestCompletionStatus({ current: 'unplayed', playtimeMinutes: 0, effectiveHours: 10, lastPlayedDaysAgo: null }),
    ).toBeNull();
  });

  it('leaves terminal user decisions alone', () => {
    expect(
      suggestCompletionStatus({ current: 'completed', playtimeMinutes: 5000, effectiveHours: 10, lastPlayedDaysAgo: 1 }),
    ).toBeNull();
    expect(
      suggestCompletionStatus({ current: 'abandoned', playtimeMinutes: 5000, effectiveHours: 10, lastPlayedDaysAgo: 1 }),
    ).toBeNull();
  });

  it('does not suggest playing for a stale in-progress game', () => {
    expect(
      suggestCompletionStatus({ current: 'unplayed', playtimeMinutes: 120, effectiveHours: 40, lastPlayedDaysAgo: 200 }),
    ).toBeNull();
  });
});
