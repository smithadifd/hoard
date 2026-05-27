import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/queries', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getUserGameCount: vi.fn(),
  getRatedGameCount: vi.fn(),
}));

import {
  getOnboardingState,
  updateOnboardingState,
  computeChecklist,
  TRIAGE_DONE_THRESHOLD,
  DEFAULT_ONBOARDING_STATE,
} from './state';
import {
  getSetting,
  setSetting,
  getUserGameCount,
  getRatedGameCount,
} from '@/lib/db/queries';

const mockGetSetting = vi.mocked(getSetting);
const mockSetSetting = vi.mocked(setSetting);
const mockGetUserGameCount = vi.mocked(getUserGameCount);
const mockGetRatedGameCount = vi.mocked(getRatedGameCount);

describe('getOnboardingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when no setting row exists', () => {
    mockGetSetting.mockReturnValue(null);
    expect(getOnboardingState('user-1')).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it('parses a stored JSON blob and normalizes unknown fields', () => {
    mockGetSetting.mockReturnValue(
      JSON.stringify({
        wizardCompletedAt: '2026-05-01T00:00:00Z',
        drainMode: 'full',
        unknownField: 'ignored',
      }),
    );
    const state = getOnboardingState('user-1');
    expect(state.wizardCompletedAt).toBe('2026-05-01T00:00:00Z');
    expect(state.drainMode).toBe('full');
    expect(state.checklistDismissed).toBe(false);
    expect((state as unknown as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it('rejects garbage values and falls back to defaults', () => {
    mockGetSetting.mockReturnValue('not-json-at-all');
    expect(getOnboardingState('user-1')).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it('drops invalid enum values silently', () => {
    mockGetSetting.mockReturnValue(JSON.stringify({ drainMode: 'turbo' }));
    expect(getOnboardingState('user-1').drainMode).toBeNull();
  });
});

describe('updateOnboardingState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue(null);
  });

  it('merges the patch over the existing state and writes JSON back', () => {
    mockGetSetting.mockReturnValue(
      JSON.stringify({ steamConnectedAt: '2026-04-01T00:00:00Z' }),
    );

    const next = updateOnboardingState('user-1', { drainMode: 'lite' });

    expect(next.steamConnectedAt).toBe('2026-04-01T00:00:00Z');
    expect(next.drainMode).toBe('lite');
    expect(mockSetSetting).toHaveBeenCalledTimes(1);
    const [key, value] = mockSetSetting.mock.calls[0]!;
    expect(key).toBe('onboarding_state:user-1');
    const parsed = JSON.parse(value);
    expect(parsed.drainMode).toBe('lite');
    expect(parsed.steamConnectedAt).toBe('2026-04-01T00:00:00Z');
  });
});

describe('computeChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setState(state: Record<string, unknown>) {
    mockGetSetting.mockImplementation((key) => {
      if (key.startsWith('onboarding_state:')) return JSON.stringify(state);
      return null;
    });
  }

  it('marks every item incomplete on a fresh install except create-account', () => {
    setState({});
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    const result = computeChecklist('user-1');
    const byKey = Object.fromEntries(result.items.map((i) => [i.key, i.done]));

    expect(byKey['create-account']).toBe(true);
    expect(byKey['connect-steam']).toBe(false);
    expect(byKey['sync-library']).toBe(false);
    expect(byKey['run-drain']).toBe(false);
    expect(byKey['triage-library']).toBe(false);
    expect(result.allDone).toBe(false);
  });

  it('marks connect-steam done once steamConnectedAt is set', () => {
    setState({ steamConnectedAt: '2026-05-01T00:00:00Z' });
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'connect-steam')!;
    expect(item.done).toBe(true);
  });

  it('marks sync-library done when the user has any games', () => {
    setState({});
    mockGetUserGameCount.mockReturnValue(1);
    mockGetRatedGameCount.mockReturnValue(0);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'sync-library')!;
    expect(item.done).toBe(true);
  });

  it('marks run-drain done when drainCompletedAt is set', () => {
    setState({ drainCompletedAt: '2026-05-02T00:00:00Z' });
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'run-drain')!;
    expect(item.done).toBe(true);
  });

  it('marks run-drain done when the user picked cron-only after starting', () => {
    setState({ drainMode: 'cron-only', drainStartedAt: '2026-05-02T00:00:00Z' });
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'run-drain')!;
    expect(item.done).toBe(true);
  });

  it('does NOT mark run-drain done if cron-only was selected but never started', () => {
    setState({ drainMode: 'cron-only', drainStartedAt: null });
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'run-drain')!;
    expect(item.done).toBe(false);
  });

  it('marks triage-library done once the user rates the threshold of games', () => {
    setState({});
    mockGetUserGameCount.mockReturnValue(100);
    mockGetRatedGameCount.mockReturnValue(TRIAGE_DONE_THRESHOLD);

    const item = computeChecklist('user-1').items.find((i) => i.key === 'triage-library')!;
    expect(item.done).toBe(true);
  });

  it('reports allDone only when every item is satisfied', () => {
    setState({
      steamConnectedAt: '2026-05-01',
      drainCompletedAt: '2026-05-02',
    });
    mockGetUserGameCount.mockReturnValue(500);
    mockGetRatedGameCount.mockReturnValue(TRIAGE_DONE_THRESHOLD);

    expect(computeChecklist('user-1').allDone).toBe(true);
  });

  it('surfaces the dismissed flag from state', () => {
    setState({ checklistDismissed: true });
    mockGetUserGameCount.mockReturnValue(0);
    mockGetRatedGameCount.mockReturnValue(0);

    expect(computeChecklist('user-1').dismissed).toBe(true);
  });
});
