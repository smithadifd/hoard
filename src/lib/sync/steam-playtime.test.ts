import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn(),
  getAndResetSteamApiCalls: vi.fn().mockReturnValue(0),
}));

vi.mock('../db/queries', () => ({
  getGamesForSteamPlaytimeSync: vi.fn(),
  updateGameSteamPlaytime: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
}));

// computePlaytimeStats + STEAM_PLAYTIME_MIN_SAMPLE are real — exercising the
// actual median/threshold logic the sync relies on.
import { syncSteamPlaytime } from './steam-playtime';
import { getSteamClient } from '../steam/client';
import {
  getGamesForSteamPlaytimeSync,
  updateGameSteamPlaytime,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';

const mockGetSteamClient = vi.mocked(getSteamClient);
const mockGetGames = vi.mocked(getGamesForSteamPlaytimeSync);
const mockUpdatePlaytime = vi.mocked(updateGameSteamPlaytime);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);

function makeGame(id: number, title: string) {
  return { id, title, steamAppId: id * 100 };
}

// `n` reviewer playtimes (minutes), all 120 → median 2.0 hours.
function sampleMinutes(n: number): number[] {
  return Array.from({ length: n }, () => 120);
}

function makeMockSteamClient(overrides: Record<string, unknown> = {}) {
  return {
    getReviewPlaytimes: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ReturnType<typeof getSteamClient>;
}

describe('syncSteamPlaytime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetGames.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with message when no wishlist games need a median', async () => {
    mockGetGames.mockReturnValue([]);

    const result = await syncSteamPlaytime();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(result.message).toContain('already have a playtime median');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0, 0);
  });

  it('stores the median when the sample meets the minimum size', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 'Hades')]);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getReviewPlaytimes: vi.fn().mockResolvedValue(sampleMinutes(25)),
    }));

    const promise = syncSteamPlaytime();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(mockUpdatePlaytime).toHaveBeenCalledWith(1, { medianHours: 2, sampleSize: 25 });
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(1);
  });

  it('marks a miss (null) when the sample is below the minimum size', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 'Niche Game')]);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getReviewPlaytimes: vi.fn().mockResolvedValue(sampleMinutes(5)),
    }));

    const promise = syncSteamPlaytime();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(mockUpdatePlaytime).toHaveBeenCalledWith(1, null);
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.succeeded).toBe(0);
  });

  it('marks a miss when getReviewPlaytimes returns null (fetch failure)', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 'Unreviewed Game')]);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getReviewPlaytimes: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncSteamPlaytime();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(mockUpdatePlaytime).toHaveBeenCalledWith(1, null);
    expect(result.stats.skipped).toBe(1);
  });

  it('counts per-game errors as failed, not crashed', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 'Erroring Game'), makeGame(2, 'Good Game')]);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getReviewPlaytimes: vi.fn()
        .mockRejectedValueOnce(new Error('Steam timeout'))
        .mockResolvedValueOnce(sampleMinutes(30)),
    }));

    const promise = syncSteamPlaytime();
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(2);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 2, 1, 0);
  });

  it('limits the batch to 50 games per run', async () => {
    const manyGames = Array.from({ length: 80 }, (_, i) => makeGame(i + 1, `Game ${i + 1}`));
    mockGetGames.mockReturnValue(manyGames);

    const fetchFn = vi.fn().mockResolvedValue(sampleMinutes(25));
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({ getReviewPlaytimes: fetchFn }));

    const promise = syncSteamPlaytime();
    await vi.advanceTimersByTimeAsync(160_000); // 50 games * 3s + buffer
    await promise;

    expect(fetchFn).toHaveBeenCalledTimes(50);
  });

  it('stops when the AbortSignal is triggered', async () => {
    const controller = new AbortController();
    mockGetGames.mockReturnValue([makeGame(1, 'A'), makeGame(2, 'B'), makeGame(3, 'C')]);

    const fetchFn = vi.fn().mockImplementation(async () => {
      controller.abort();
      return sampleMinutes(25);
    });
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({ getReviewPlaytimes: fetchFn }));

    const promise = syncSteamPlaytime(undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    expect(result.stats.attempted).toBe(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('reports onProgress for each game with the correct status', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 'Sampled Game'), makeGame(2, 'Thin Game')]);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getReviewPlaytimes: vi.fn()
        .mockResolvedValueOnce(sampleMinutes(25))
        .mockResolvedValueOnce(sampleMinutes(3)),
    }));

    const onProgress = vi.fn();
    const promise = syncSteamPlaytime(onProgress);
    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    expect(onProgress).toHaveBeenCalledWith(0, 2, { gameName: 'Sampled Game', status: 'processing' });
    expect(onProgress).toHaveBeenCalledWith(1, 2, { gameName: 'Sampled Game', status: 'matched' });
    expect(onProgress).toHaveBeenCalledWith(1, 2, { gameName: 'Thin Game', status: 'processing' });
    expect(onProgress).toHaveBeenCalledWith(2, 2, { gameName: 'Thin Game', status: 'skipped' });
  });

  it('propagates fatal errors and logs sync failure', async () => {
    mockGetGames.mockImplementation(() => { throw new Error('DB connection failed'); });

    await expect(syncSteamPlaytime()).rejects.toThrow('DB connection failed');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'DB connection failed', undefined, undefined, 0);
  });
});
