import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn().mockReturnValue({
    getAppDetails: vi.fn(),
  }),
}));

vi.mock('../discord/client', () => ({
  getDiscordClient: vi.fn().mockReturnValue({
    sendReleaseNotification: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../db/queries', () => ({
  getGamesForReleaseCheck: vi.fn(),
  updateReleaseStatus: vi.fn(),
  createSyncLog: vi.fn().mockReturnValue(1),
  completeSyncLog: vi.fn(),
}));

import { checkReleaseStatus } from './releases';
import { getSteamClient } from '../steam/client';
import { getDiscordClient } from '../discord/client';
import { getGamesForReleaseCheck, updateReleaseStatus, completeSyncLog } from '../db/queries';

const mockSteam = vi.mocked(getSteamClient)().getAppDetails as ReturnType<typeof vi.fn>;
const mockDiscord = vi.mocked(getDiscordClient)().sendReleaseNotification as ReturnType<typeof vi.fn>;
const mockGetGames = vi.mocked(getGamesForReleaseCheck);
const mockUpdateRelease = vi.mocked(updateReleaseStatus);
const mockComplete = vi.mocked(completeSyncLog);

describe('checkReleaseStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use fake timers so sleep() resolves instantly
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with zero stats when no unreleased games', async () => {
    mockGetGames.mockReturnValue([]);

    const result = await checkReleaseStatus();

    expect(result.stats.attempted).toBe(0);
    expect(result.stats.succeeded).toBe(0);
    expect(mockComplete).toHaveBeenCalledWith(1, 'success', 0, undefined, 0, 0);
  });

  it('marks game as released when coming_soon is false', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'New Game' },
    ]);
    mockSteam.mockResolvedValue({
      release_date: { coming_soon: false, date: '2026-03-15' },
      header_image: 'https://example.com/img.jpg',
    });

    const result = await checkReleaseStatus();

    expect(mockUpdateRelease).toHaveBeenCalledWith(1, { isReleased: true, releaseDate: '2026-03-15' });
    expect(mockDiscord).toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.failed).toBe(0);
  });

  it('refreshes releaseDate string but does not flip isReleased when coming_soon is true', async () => {
    // Steam tightens release dates as launch approaches — e.g. "later in 2026"
    // can become "Jul 7, 2026". The release check is the only place existing
    // unreleased entries get refreshed, so it must update the date string.
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Upcoming Game' },
    ]);
    mockSteam.mockResolvedValue({
      release_date: { coming_soon: true, date: 'Jul 7, 2026' },
    });

    const result = await checkReleaseStatus();

    expect(mockUpdateRelease).toHaveBeenCalledWith(1, { isReleased: false, releaseDate: 'Jul 7, 2026' });
    expect(mockDiscord).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(1);
  });

  it('counts getAppDetails returning null as failed', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Delisted Game' },
    ]);
    mockSteam.mockResolvedValue(null);

    const result = await checkReleaseStatus();

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(0);
    expect(mockUpdateRelease).not.toHaveBeenCalled();
  });

  it('reports correct stats with mixed results', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Released' },
      { id: 2, steamAppId: 200, title: 'Failed' },
    ]);
    mockSteam
      .mockResolvedValueOnce({ release_date: { coming_soon: false, date: '2026-03-15' } })
      .mockResolvedValueOnce(null);

    const result = await checkReleaseStatus();

    expect(result.stats.attempted).toBe(2);
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.failed).toBe(1);
    expect(mockComplete).toHaveBeenCalledWith(1, 'partial', 1, undefined, 2, 1);
  });

  it('uses error status when all games fail', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Failed' },
    ]);
    mockSteam.mockResolvedValue(null);

    await checkReleaseStatus();

    expect(mockComplete).toHaveBeenCalledWith(1, 'error', 0, undefined, 1, 1);
  });
});
