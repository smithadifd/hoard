import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  upsertGameFromSteam: vi.fn(),
  upsertUserGame: vi.fn(),
  getExistingGamesByAppIds: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
  updateUserGame: vi.fn(),
}));

// Mock getDb to return a fake DB with chainable query builder
const mockDbAll = vi.fn().mockReturnValue([]);
vi.mock('../db/index', () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            all: mockDbAll,
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('../db/schema', () => ({
  games: { id: 'games.id', steamAppId: 'games.steam_app_id' },
  userGames: {
    gameId: 'user_games.game_id',
    userId: 'user_games.user_id',
    isWishlisted: 'user_games.is_wishlisted',
    wishlistRemovedAt: 'user_games.wishlist_removed_at',
  },
}));

import { syncWishlist } from './wishlist';
import { getSteamClient } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  getExistingGamesByAppIds,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  updateUserGame,
} from '../db/queries';

const mockGetSteamClient = vi.mocked(getSteamClient);
const mockUpsertGame = vi.mocked(upsertGameFromSteam);
const mockUpsertUserGame = vi.mocked(upsertUserGame);
const mockGetExisting = vi.mocked(getExistingGamesByAppIds);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetFirstUserId = vi.mocked(getFirstUserId);
const _mockUpdateUserGame = vi.mocked(updateUserGame);

function makeWishlistEntry(appid: number, priority = 0) {
  return { appid, priority, date_added: 1700000000 };
}

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getWishlist: vi.fn().mockResolvedValue([]),
    getAppDetails: vi.fn().mockResolvedValue(null),
    getReviewSummary: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ReturnType<typeof getSteamClient>;
}

describe('syncWishlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetFirstUserId.mockReturnValue('user-1');
    mockUpsertGame.mockReturnValue(1);
    mockGetExisting.mockReturnValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with zero stats when wishlist is empty', async () => {
    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue([]),
    }));

    const result = await syncWishlist();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('uses fast path for games already in the database', async () => {
    const entries = [makeWishlistEntry(440), makeWishlistEntry(570)];
    const existing = new Map([
      [440, { id: 10, title: 'Team Fortress 2' }],
      [570, { id: 20, title: 'Dota 2' }],
    ]);

    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
    }));
    mockGetExisting.mockReturnValue(existing);

    const result = await syncWishlist();

    // Should not call getAppDetails for existing games
    expect(mockUpsertUserGame).toHaveBeenCalledTimes(2);
    expect(mockUpsertUserGame).toHaveBeenCalledWith(10, { isWishlisted: true }, 'user-1');
    expect(mockUpsertUserGame).toHaveBeenCalledWith(20, { isWishlisted: true }, 'user-1');
    expect(mockUpsertGame).not.toHaveBeenCalled();
    expect(result.stats.succeeded).toBe(2);
  });

  it('fetches app details for new games not in the database', async () => {
    const entries = [makeWishlistEntry(999)];
    const mockClient = makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
      getAppDetails: vi.fn().mockResolvedValue({
        name: 'New Game',
        header_image: 'https://img.com/header.jpg',
        short_description: 'A new game',
        release_date: { date: '2024-01-01', coming_soon: false },
        developers: ['Dev Studio'],
        publishers: ['Publisher Inc'],
      }),
      getReviewSummary: vi.fn().mockResolvedValue({
        total_positive: 90,
        total_negative: 10,
        total_reviews: 100,
        review_score_desc: 'Very Positive',
      }),
    });
    mockGetSteamClient.mockReturnValue(mockClient);
    mockGetExisting.mockReturnValue(new Map());
    mockUpsertGame.mockReturnValue(50);

    const promise = syncWishlist();
    // Advance past the 3s rate-limit delay
    await vi.advanceTimersByTimeAsync(3100);
    const result = await promise;

    expect(mockUpsertGame).toHaveBeenCalledWith(
      expect.objectContaining({
        steamAppId: 999,
        title: 'New Game',
        headerImageUrl: 'https://img.com/header.jpg',
        developer: 'Dev Studio',
        publisher: 'Publisher Inc',
      })
    );
    // Second upsert call with review data
    expect(mockUpsertGame).toHaveBeenCalledWith(
      expect.objectContaining({
        steamAppId: 999,
        reviewScore: 90,
        reviewCount: 100,
        reviewDescription: 'Very Positive',
      })
    );
    expect(mockUpsertUserGame).toHaveBeenCalledWith(50, { isWishlisted: true }, 'user-1');
    expect(result.stats.succeeded).toBe(1);
  });

  it('uses fallback title when getAppDetails returns null', async () => {
    const entries = [makeWishlistEntry(888)];
    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
      getAppDetails: vi.fn().mockResolvedValue(null),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncWishlist();
    await vi.advanceTimersByTimeAsync(3100);
    const result = await promise;

    expect(mockUpsertGame).toHaveBeenCalledWith(
      expect.objectContaining({
        steamAppId: 888,
        title: 'App 888',
      })
    );
    expect(result.stats.succeeded).toBe(1);
  });

  it('handles mix of existing and new games', async () => {
    const entries = [makeWishlistEntry(440), makeWishlistEntry(999)];
    const existing = new Map([[440, { id: 10, title: 'TF2' }]]);

    const mockClient = makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
      getAppDetails: vi.fn().mockResolvedValue({ name: 'New Game' }),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    });
    mockGetSteamClient.mockReturnValue(mockClient);
    mockGetExisting.mockReturnValue(existing);
    mockUpsertGame.mockReturnValue(50);

    const onProgress = vi.fn();
    const promise = syncWishlist(onProgress);
    await vi.advanceTimersByTimeAsync(3100);
    const result = await promise;

    expect(result.stats.succeeded).toBe(2);
    expect(result.stats.attempted).toBe(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('stops processing when AbortSignal is triggered during existing games', async () => {
    const controller = new AbortController();
    const entries = [makeWishlistEntry(1), makeWishlistEntry(2), makeWishlistEntry(3)];
    const existing = new Map([
      [1, { id: 10, title: 'Game 1' }],
      [2, { id: 20, title: 'Game 2' }],
      [3, { id: 30, title: 'Game 3' }],
    ]);

    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
    }));
    mockGetExisting.mockReturnValue(existing);

    // Abort after the first game
    mockUpsertUserGame.mockImplementationOnce(() => {
      controller.abort();
    });

    const result = await syncWishlist(undefined, controller.signal);

    expect(result.stats.succeeded).toBe(1);
  });

  it('stops processing when AbortSignal is triggered during new games', async () => {
    const controller = new AbortController();
    const entries = [makeWishlistEntry(1), makeWishlistEntry(2)];

    const mockClient = makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
      getAppDetails: vi.fn().mockImplementation(async () => {
        controller.abort();
        return { name: 'Game' };
      }),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    });
    mockGetSteamClient.mockReturnValue(mockClient);

    const promise = syncWishlist(undefined, controller.signal);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    // Should process at most 1 new game before abort kicks in
    expect(result.stats.succeeded).toBeLessThanOrEqual(1);
  });

  it('sets isReleased to false when coming_soon is true', async () => {
    const entries = [makeWishlistEntry(999)];
    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue(entries),
      getAppDetails: vi.fn().mockResolvedValue({
        name: 'Upcoming Game',
        release_date: { date: 'Coming Soon', coming_soon: true },
      }),
      getReviewSummary: vi.fn().mockResolvedValue(null),
    }));

    const promise = syncWishlist();
    await vi.advanceTimersByTimeAsync(3100);
    await promise;

    expect(mockUpsertGame).toHaveBeenCalledWith(
      expect.objectContaining({ isReleased: false })
    );
  });

  it('uses provided userId instead of getFirstUserId', async () => {
    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockResolvedValue([makeWishlistEntry(440)]),
    }));
    mockGetExisting.mockReturnValue(new Map([[440, { id: 10, title: 'TF2' }]]));

    await syncWishlist(undefined, undefined, 'custom-user');

    expect(mockUpsertUserGame).toHaveBeenCalledWith(10, { isWishlisted: true }, 'custom-user');
  });

  it('propagates errors and logs sync failure', async () => {
    mockGetSteamClient.mockReturnValue(makeMockClient({
      getWishlist: vi.fn().mockRejectedValue(new Error('Steam API down')),
    }));

    await expect(syncWishlist()).rejects.toThrow('Steam API down');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'Steam API down');
  });
});
