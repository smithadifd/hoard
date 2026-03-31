import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries', () => ({
  getRecentSyncStats: vi.fn(),
  getSyncLogsSince: vi.fn(),
}));

vi.mock('../discord/client', () => ({
  getDiscordClient: vi.fn(),
}));

import { evaluateSyncHealth, sendWeeklyHealthSummary } from './health';
import { getRecentSyncStats, getSyncLogsSince } from '../db/queries';
import { getDiscordClient } from '../discord/client';

const mockGetRecentSyncStats = vi.mocked(getRecentSyncStats);
const mockGetSyncLogsSince = vi.mocked(getSyncLogsSince);
const mockGetDiscordClient = vi.mocked(getDiscordClient);

function makeMockDiscord() {
  return {
    sendOperationalAlert: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getDiscordClient>;
}

describe('evaluateSyncHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when source has no threshold defined', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await evaluateSyncHealth('steam_library', { attempted: 10, succeeded: 2, failed: 8, skipped: 0 });

    expect(mockDiscord.sendOperationalAlert).not.toHaveBeenCalled();
  });

  it('does nothing when stats.attempted is 0', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    await evaluateSyncHealth('hltb', { attempted: 0, succeeded: 0, failed: 0, skipped: 0 });

    expect(mockDiscord.sendOperationalAlert).not.toHaveBeenCalled();
  });

  it('does nothing when success rate is at or above threshold', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    // hltb threshold is 0.20, rate here is 5/10 = 0.50
    await evaluateSyncHealth('hltb', { attempted: 10, succeeded: 5, failed: 5, skipped: 0 });

    expect(mockDiscord.sendOperationalAlert).not.toHaveBeenCalled();
  });

  it('sends Discord alert when rate is below threshold', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);
    mockGetRecentSyncStats.mockReturnValue([]);

    // hltb threshold is 0.20, rate here is 1/10 = 0.10
    await evaluateSyncHealth('hltb', { attempted: 10, succeeded: 1, failed: 9, skipped: 0 });

    expect(mockDiscord.sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Low Success Rate: hltb',
        color: 0xf59e0b,
      })
    );
  });

  it('includes recent run summary in Discord embed when prior runs exist', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);
    mockGetRecentSyncStats.mockReturnValue([
      { status: 'success', itemsProcessed: 8, itemsAttempted: 10 },
      { status: 'partial', itemsProcessed: 3, itemsAttempted: 10 },
      { status: 'error', itemsProcessed: 0, itemsAttempted: 5 },
    ] as ReturnType<typeof getRecentSyncStats>);

    await evaluateSyncHealth('reviews', { attempted: 10, succeeded: 2, failed: 8, skipped: 0 });

    expect(mockDiscord.sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'Recent Runs', value: '8/10, 3/10' }),
        ]),
      })
    );
  });
});

describe('sendWeeklyHealthSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends green embed when all sources have runs and good success rates', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    // Return healthy logs for every source
    mockGetSyncLogsSince.mockReturnValue([
      {
        status: 'success',
        itemsProcessed: 10,
        itemsAttempted: 10,
        itemsFailed: 0,
        completedAt: new Date().toISOString(),
      },
    ] as unknown as ReturnType<typeof getSyncLogsSince>);

    await sendWeeklyHealthSummary();

    expect(mockDiscord.sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekly Sync Health Summary',
        description: 'All sync sources operating normally.',
        color: 0x22c55e, // Green
      })
    );
  });

  it('sends amber embed when a required source has no runs', async () => {
    const mockDiscord = makeMockDiscord();
    mockGetDiscordClient.mockReturnValue(mockDiscord);

    // Return empty for steam_library (required), logs for others
    mockGetSyncLogsSince.mockImplementation((source: string) => {
      if (source === 'steam_library') return [];
      return [
        {
          status: 'success',
          itemsProcessed: 10,
          itemsAttempted: 10,
          itemsFailed: 0,
          completedAt: new Date().toISOString(),
        },
      ] as unknown as ReturnType<typeof getSyncLogsSince>;
    });

    await sendWeeklyHealthSummary();

    expect(mockDiscord.sendOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekly Sync Health Summary',
        description: 'Some sync sources are below expected thresholds.',
        color: 0xf59e0b, // Amber
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'steam_library', value: 'No runs (expected weekly)' }),
        ]),
      })
    );
  });
});
