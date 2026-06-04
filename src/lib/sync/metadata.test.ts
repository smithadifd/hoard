import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../steam/client', () => ({
  getSteamClient: vi.fn().mockReturnValue({
    getAppDetails: vi.fn(),
    getReviewSummary: vi.fn(),
  }),
  getAndResetSteamApiCalls: vi.fn().mockReturnValue(0),
}));

vi.mock('../discord/client', () => ({
  getDiscordClient: vi.fn().mockReturnValue({
    sendEarlyAccessGraduation: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../db/queries', () => ({
  getGamesForMetadataRefresh: vi.fn(),
  getEarlyAccessSnapshot: vi.fn(),
  updateGameMetadata: vi.fn(),
  getFirstUserId: vi.fn().mockReturnValue('default'),
  createSyncLog: vi.fn().mockReturnValue(1),
  completeSyncLog: vi.fn(),
}));

import { refreshMetadata } from './metadata';
import { getSteamClient } from '../steam/client';
import { getDiscordClient } from '../discord/client';
import {
  getGamesForMetadataRefresh,
  getEarlyAccessSnapshot,
  updateGameMetadata,
  completeSyncLog,
} from '../db/queries';

const mockGetAppDetails = vi.mocked(getSteamClient)().getAppDetails as ReturnType<typeof vi.fn>;
const mockGetReviews = vi.mocked(getSteamClient)().getReviewSummary as ReturnType<typeof vi.fn>;
const mockGraduation = vi.mocked(getDiscordClient)().sendEarlyAccessGraduation as ReturnType<typeof vi.fn>;
const mockGetGames = vi.mocked(getGamesForMetadataRefresh);
const mockGetEa = vi.mocked(getEarlyAccessSnapshot);
const mockUpdate = vi.mocked(updateGameMetadata);
const mockComplete = vi.mocked(completeSyncLog);

const FIXTURE_DETAILS = {
  release_date: { coming_soon: false, date: 'Mar 15, 2026' },
  header_image: 'https://cdn.steam/header.jpg',
  categories: [{ id: 2, description: 'Single-player' }],
};

const FIXTURE_REVIEWS = {
  num_reviews: 100,
  review_score: 8,
  review_score_desc: 'Very Positive',
  total_positive: 85,
  total_negative: 15,
  total_reviews: 100,
};

describe('refreshMetadata', () => {
  beforeEach(() => {
    // mockReset clears both calls AND queued mockResolvedValueOnce values so
    // leftover queue entries from a prior test can't bleed into this one.
    mockGetAppDetails.mockReset();
    mockGetReviews.mockReset();
    mockGraduation.mockReset().mockResolvedValue(true);
    mockGetGames.mockReset();
    mockGetEa.mockReset().mockReturnValue(null);
    mockUpdate.mockReset();
    mockComplete.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early with zero stats when no games to refresh', async () => {
    mockGetGames.mockReturnValue([]);

    const result = await refreshMetadata();

    expect(result.stats.attempted).toBe(0);
    expect(mockComplete).toHaveBeenCalledWith(1, 'success', 0, undefined, 0, 0, 0);
  });

  it('writes a fresh batch of metadata for each game', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Game One', metadataLastUpdated: null },
    ]);
    mockGetAppDetails.mockResolvedValue(FIXTURE_DETAILS);
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    const result = await refreshMetadata();

    expect(mockUpdate).toHaveBeenCalledWith(1, {
      releaseDate: 'Mar 15, 2026',
      isReleased: true,
      isEarlyAccess: false,
      reviewScore: 85,
      reviewCount: 100,
      reviewDescription: 'Very Positive',
    });
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.failed).toBe(0);
  });

  it('fires EA graduation Discord notification when isEarlyAccess flips true → false', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Hades II', metadataLastUpdated: null },
    ]);
    mockGetEa.mockReturnValue(true); // was in EA
    mockGetAppDetails.mockResolvedValue(FIXTURE_DETAILS); // genres has no id "70" → no longer EA
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    await refreshMetadata();

    expect(mockGraduation).toHaveBeenCalledWith({
      title: 'Hades II',
      steamAppId: 100,
      headerImageUrl: 'https://cdn.steam/header.jpg',
      reviewDescription: 'Very Positive',
    });
  });

  it('does not fire EA graduation when prior state is unknown (null)', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Unknown Prior', metadataLastUpdated: null },
    ]);
    mockGetEa.mockReturnValue(null);
    mockGetAppDetails.mockResolvedValue(FIXTURE_DETAILS);
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    await refreshMetadata();

    expect(mockGraduation).not.toHaveBeenCalled();
  });

  it('does not fire EA graduation when game is still in Early Access', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Still EA', metadataLastUpdated: null },
    ]);
    mockGetEa.mockReturnValue(true);
    mockGetAppDetails.mockResolvedValue({
      ...FIXTURE_DETAILS,
      genres: [{ id: '70', description: 'Early Access' }],
    });
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    await refreshMetadata();

    expect(mockGraduation).not.toHaveBeenCalled();
  });

  it('counts a game as failed when both Steam calls return null', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Delisted', metadataLastUpdated: null },
    ]);
    mockGetAppDetails.mockResolvedValue(null);
    mockGetReviews.mockResolvedValue(null);

    const result = await refreshMetadata();

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(0);
    // Still bumps metadataLastUpdated to rotate the LRU drain past this row
    expect(mockUpdate).toHaveBeenCalledWith(1, {});
  });

  it('counts as failed when appdetails is null even if reviews succeeded', async () => {
    // Asymmetric Steam failure: appdetails rate-limited, reviews came back fine.
    // The whole point of this job is to refresh release/EA fields, which need
    // appdetails — so this is not a successful refresh.
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Partial', metadataLastUpdated: null },
    ]);
    mockGetEa.mockReturnValue(true); // was in EA
    mockGetAppDetails.mockResolvedValue(null);
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    const result = await refreshMetadata();

    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(0);
    // Whatever reviews we got still get written so the run isn't wasted.
    expect(mockUpdate).toHaveBeenCalledWith(1, {
      reviewScore: 85,
      reviewCount: 100,
      reviewDescription: 'Very Positive',
    });
    // No graduation fires — we can't tell if EA flipped without appdetails.
    expect(mockGraduation).not.toHaveBeenCalled();
  });

  it('does not let one throwing game kill the loop', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'Throws', metadataLastUpdated: null },
      { id: 2, steamAppId: 200, title: 'Succeeds', metadataLastUpdated: null },
    ]);
    // Route by appId so a thrown call doesn't poison the queue for the other game.
    // (Game 1 throws on getAppDetails, so it never reaches getReviewSummary —
    // a queued mockResolvedValueOnce on reviews would otherwise leak into game 2.)
    mockGetAppDetails.mockImplementation(async (appId: number) => {
      if (appId === 100) throw new Error('Steam exploded');
      return FIXTURE_DETAILS;
    });
    mockGetReviews.mockImplementation(async (appId: number) => {
      if (appId === 100) throw new Error('Reviews exploded');
      return FIXTURE_REVIEWS;
    });

    const result = await refreshMetadata();

    expect(result.stats.attempted).toBe(2);
    expect(result.stats.failed).toBe(1);
    expect(result.stats.succeeded).toBe(1);
  });

  it('respects abort signal and stops processing remaining games', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'First', metadataLastUpdated: null },
      { id: 2, steamAppId: 200, title: 'Second', metadataLastUpdated: null },
    ]);
    mockGetAppDetails.mockResolvedValue(FIXTURE_DETAILS);
    mockGetReviews.mockResolvedValue(FIXTURE_REVIEWS);

    const controller = new AbortController();
    controller.abort();

    const result = await refreshMetadata(undefined, controller.signal);

    expect(result.stats.attempted).toBe(0);
  });

  it('reports partial status when some succeed and some fail', async () => {
    mockGetGames.mockReturnValue([
      { id: 1, steamAppId: 100, title: 'OK', metadataLastUpdated: null },
      { id: 2, steamAppId: 200, title: 'Fail', metadataLastUpdated: null },
    ]);
    mockGetAppDetails
      .mockResolvedValueOnce(FIXTURE_DETAILS)
      .mockResolvedValueOnce(null);
    mockGetReviews
      .mockResolvedValueOnce(FIXTURE_REVIEWS)
      .mockResolvedValueOnce(null);

    await refreshMetadata();

    expect(mockComplete).toHaveBeenCalledWith(1, 'partial', 1, undefined, 2, 1, 0);
  });
});
