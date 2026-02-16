import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  getGamesForReviewSync: vi.fn(),
  updateGameReviewData: vi.fn(),
  upsertTags: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
}));

import { syncReviews } from './reviews';
import { getSteamClient } from '../steam/client';
import {
  getGamesForReviewSync,
  updateGameReviewData,
  upsertTags,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';

const mockGetSteamClient = vi.mocked(getSteamClient);
const mockGetGames = vi.mocked(getGamesForReviewSync);
const mockUpdateReview = vi.mocked(updateGameReviewData);
const mockUpsertTags = vi.mocked(upsertTags);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);

function makeGame(id: number, steamAppId: number, title: string) {
  return { id, steamAppId, title };
}

function makeAppDetails(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Game',
    short_description: 'A test game',
    developers: ['Dev Studio'],
    publishers: ['Publisher Inc'],
    genres: [{ id: '1', description: 'Action' }, { id: '2', description: 'RPG' }],
    categories: [
      { id: 1, description: 'Single-player' },
      { id: 2, description: 'Multi-player' },
    ],
    ...overrides,
  };
}

function makeReviewSummary(positive = 90, negative = 10, desc = 'Very Positive') {
  return {
    total_positive: positive,
    total_negative: negative,
    total_reviews: positive + negative,
    review_score_desc: desc,
  };
}

function makeMockSteamClient(overrides: Record<string, unknown> = {}) {
  return {
    getAppDetails: vi.fn().mockResolvedValue(null),
    getReviewSummary: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ReturnType<typeof getSteamClient>;
}

describe('syncReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetGames.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with message when no games need review data', async () => {
    mockGetGames.mockReturnValue([]);

    const result = await syncReviews();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(result.message).toContain('All games already have review data');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('enriches game with review data and app details', async () => {
    const games = [makeGame(1, 440, 'TF2')];
    mockGetGames.mockReturnValue(games);

    const details = makeAppDetails();
    const reviews = makeReviewSummary(90, 10, 'Very Positive');

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(details),
      getReviewSummary: vi.fn().mockResolvedValue(reviews),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(mockUpdateReview).toHaveBeenCalledWith(1, expect.objectContaining({
      reviewScore: 90,
      reviewCount: 100,
      reviewDescription: 'Very Positive',
      description: 'A test game',
      developer: 'Dev Studio',
      publisher: 'Publisher Inc',
      isCoop: false,
      isMultiplayer: true,
    }));
    expect(result.stats.succeeded).toBe(1);
  });

  it('detects co-op from categories', async () => {
    const games = [makeGame(1, 440, 'Portal 2')];
    mockGetGames.mockReturnValue(games);

    const details = makeAppDetails({
      categories: [
        { id: 1, description: 'Single-player' },
        { id: 2, description: 'Online Co-Op' },
      ],
    });

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(details),
      getReviewSummary: vi.fn().mockResolvedValue(makeReviewSummary()),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockUpdateReview).toHaveBeenCalledWith(1, expect.objectContaining({
      isCoop: true,
    }));
  });

  it('upserts genre and category tags', async () => {
    const games = [makeGame(1, 440, 'TF2')];
    mockGetGames.mockReturnValue(games);

    const details = makeAppDetails({
      genres: [{ id: '1', description: 'Action' }, { id: '2', description: 'FPS' }],
      categories: [{ id: 1, description: 'Multi-player' }],
    });

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(details),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockUpsertTags).toHaveBeenCalledWith(1, ['Action', 'FPS'], 'genre');
    expect(mockUpsertTags).toHaveBeenCalledWith(1, ['Multi-player'], 'category');
  });

  it('skips game when both details and reviews return null', async () => {
    const games = [makeGame(1, 440, 'Delisted Game')];
    mockGetGames.mockReturnValue(games);

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(null),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    // Should mark as checked with empty data
    expect(mockUpdateReview).toHaveBeenCalledWith(1, {});
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.succeeded).toBe(0);
  });

  it('processes with only review data when details return null', async () => {
    const games = [makeGame(1, 440, 'TF2')];
    mockGetGames.mockReturnValue(games);

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(null),
      getReviewSummary: vi.fn().mockResolvedValue(makeReviewSummary(80, 20, 'Mostly Positive')),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(mockUpdateReview).toHaveBeenCalledWith(1, {
      reviewScore: 80,
      reviewCount: 100,
      reviewDescription: 'Mostly Positive',
    });
    expect(result.stats.succeeded).toBe(1);
  });

  it('processes with only app details when reviews return null', async () => {
    const games = [makeGame(1, 440, 'TF2')];
    mockGetGames.mockReturnValue(games);

    const details = makeAppDetails({
      categories: [{ id: 1, description: 'Co-Op' }],
    });

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(details),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(mockUpdateReview).toHaveBeenCalledWith(1, expect.objectContaining({
      description: 'A test game',
      developer: 'Dev Studio',
      isCoop: true,
    }));
    // Should NOT have review fields
    const callArgs = mockUpdateReview.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('reviewScore');
    expect(result.stats.succeeded).toBe(1);
  });

  it('counts per-game errors as failed without crashing the entire sync', async () => {
    const games = [makeGame(1, 440, 'Erroring Game'), makeGame(2, 570, 'Good Game')];
    mockGetGames.mockReturnValue(games);

    const mockClient = makeMockSteamClient({
      getAppDetails: vi.fn()
        .mockRejectedValueOnce(new Error('Steam rate limit'))
        .mockResolvedValueOnce(makeAppDetails()),
      getReviewSummary: vi.fn()
        .mockResolvedValueOnce(null)  // won't be reached for first game
        .mockResolvedValueOnce(makeReviewSummary()),
    });
    mockGetSteamClient.mockReturnValue(mockClient);

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(2);
    // Failed game should still be marked as checked
    expect(mockUpdateReview).toHaveBeenCalledWith(1, {});
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 2, 1);
  });

  it('limits batch to 100 games', async () => {
    const manyGames = Array.from({ length: 150 }, (_, i) => makeGame(i + 1, i + 100, `Game ${i + 1}`));
    mockGetGames.mockReturnValue(manyGames);

    const getDetailsFn = vi.fn().mockResolvedValue(null);
    const getReviewsFn = vi.fn().mockResolvedValue(null);
    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: getDetailsFn,
      getReviewSummary: getReviewsFn,
    }));

    const promise = syncReviews();
    // 100 games * 3s delay = 300s + buffer
    await vi.advanceTimersByTimeAsync(310_000);
    await promise;

    expect(getDetailsFn).toHaveBeenCalledTimes(100);
  });

  it('stops when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const games = [makeGame(1, 440, 'Game A'), makeGame(2, 570, 'Game B')];
    mockGetGames.mockReturnValue(games);

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockImplementation(async () => {
        controller.abort();
        return makeAppDetails();
      }),
      getReviewSummary: vi.fn().mockResolvedValue(makeReviewSummary()),
    }));

    const promise = syncReviews(undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.stats.attempted).toBe(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('calls onProgress with correct statuses', async () => {
    const games = [makeGame(1, 440, 'Enriched Game')];
    mockGetGames.mockReturnValue(games);

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(makeAppDetails()),
      getReviewSummary: vi.fn().mockResolvedValue(makeReviewSummary()),
    }));

    const onProgress = vi.fn();
    const promise = syncReviews(onProgress);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(onProgress).toHaveBeenCalledWith(0, 1, { gameName: 'Enriched Game', status: 'processing' });
    expect(onProgress).toHaveBeenCalledWith(1, 1, { gameName: 'Enriched Game', status: 'enriched' });
  });

  it('does not upsert genres when details has no genres', async () => {
    const games = [makeGame(1, 440, 'No Genre Game')];
    mockGetGames.mockReturnValue(games);

    mockGetSteamClient.mockReturnValue(makeMockSteamClient({
      getAppDetails: vi.fn().mockResolvedValue(makeAppDetails({
        genres: [],
        categories: [],
      })),
      getReviewSummary: vi.fn().mockResolvedValue(makeReviewSummary()),
    }));

    const promise = syncReviews();
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockUpsertTags).not.toHaveBeenCalled();
  });

  it('propagates fatal errors and logs sync failure', async () => {
    mockGetGames.mockImplementation(() => { throw new Error('DB connection failed'); });

    await expect(syncReviews()).rejects.toThrow('DB connection failed');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'DB connection failed');
  });
});
