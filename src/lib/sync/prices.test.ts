import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  getEffectiveConfig: vi.fn(),
}));

vi.mock('../itad/client', () => ({
  getITADClient: vi.fn(),
}));

vi.mock('../scoring/engine', () => ({
  calculateDealScore: vi.fn(),
}));

vi.mock('../db/queries', () => ({
  getGamesForPriceSync: vi.fn(),
  bulkUpdateGameItadIds: vi.fn(),
  insertPriceSnapshot: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getFirstUserId: vi.fn(),
}));

// Mock the dynamic import of alerts
vi.mock('./alerts', () => ({
  checkPriceAlerts: vi.fn().mockResolvedValue(undefined),
}));

import { syncPrices } from './prices';
import { getEffectiveConfig } from '../config';
import { getITADClient } from '../itad/client';
import { calculateDealScore } from '../scoring/engine';
import {
  getGamesForPriceSync,
  bulkUpdateGameItadIds,
  insertPriceSnapshot,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
} from '../db/queries';

const mockGetConfig = vi.mocked(getEffectiveConfig);
const mockGetITADClient = vi.mocked(getITADClient);
const mockCalculateDealScore = vi.mocked(calculateDealScore);
const mockGetGamesForPriceSync = vi.mocked(getGamesForPriceSync);
const mockBulkUpdateItadIds = vi.mocked(bulkUpdateGameItadIds);
const mockInsertPriceSnapshot = vi.mocked(insertPriceSnapshot);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetFirstUserId = vi.mocked(getFirstUserId);

function makeGame(id: number, steamAppId: number, title: string, itadGameId?: string) {
  return { id, steamAppId, title, itadGameId: itadGameId ?? null };
}

function makeOverview(id: string, currentPrice: number, regularPrice: number, options: {
  cut?: number;
  storeName?: string;
  historicalLow?: number;
  url?: string;
  gameUrl?: string;
} = {}) {
  return {
    id,
    current: {
      price: { amount: currentPrice, currency: 'USD' },
      regular: { amount: regularPrice, currency: 'USD' },
      cut: options.cut ?? Math.round((1 - currentPrice / regularPrice) * 100),
      shop: { name: options.storeName ?? 'Steam' },
      url: options.url,
    },
    lowest: options.historicalLow !== undefined
      ? { price: { amount: options.historicalLow, currency: 'USD' } }
      : undefined,
    urls: { game: options.gameUrl },
  };
}

function makeMockITADClient(overrides: Record<string, unknown> = {}) {
  return {
    lookupBySteamAppIds: vi.fn().mockResolvedValue(new Map()),
    getOverview: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ReturnType<typeof getITADClient>;
}

describe('syncPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSyncLog.mockReturnValue(42);
    mockGetFirstUserId.mockReturnValue('user-1');
    mockGetConfig.mockReturnValue({
      itadApiKey: 'test-itad-key',
    } as ReturnType<typeof getEffectiveConfig>);
    mockCalculateDealScore.mockReturnValue({
      overall: 75,
      priceScore: 80,
      reviewScore: 70,
      valueScore: 60,
      interestScore: 50,
    } as ReturnType<typeof calculateDealScore>);
  });

  it('throws when ITAD API key is not configured', async () => {
    mockGetConfig.mockReturnValue({
      itadApiKey: '',
    } as ReturnType<typeof getEffectiveConfig>);

    await expect(syncPrices()).rejects.toThrow('ITAD API Key is required');
    expect(mockCreateSyncLog).not.toHaveBeenCalled();
  });

  it('returns early with zero stats when no games need sync', async () => {
    mockGetGamesForPriceSync.mockReturnValue([]);

    const result = await syncPrices();

    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 0, undefined, 0, 0);
  });

  it('resolves missing ITAD IDs before fetching prices', async () => {
    const games = [
      makeGame(1, 440, 'TF2'),      // no itadGameId
      makeGame(2, 570, 'Dota 2', 'dota2'),  // already has itadGameId
    ];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const lookupResult = new Map([[440, 'tf2']]);
    const mockClient = makeMockITADClient({
      lookupBySteamAppIds: vi.fn().mockResolvedValue(lookupResult),
      getOverview: vi.fn().mockResolvedValue([
        makeOverview('tf2', 0, 0, { cut: 0 }),
        makeOverview('dota2', 0, 0, { cut: 0 }),
      ]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    // Should only look up games without ITAD IDs
    expect(mockClient.lookupBySteamAppIds).toHaveBeenCalledWith([440], expect.any(Function));
    expect(mockBulkUpdateItadIds).toHaveBeenCalledWith([{ steamAppId: 440, itadGameId: 'tf2' }]);
  });

  it('skips lookup phase when all games already have ITAD IDs', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([makeOverview('tf2', 9.99, 19.99)]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    expect(mockClient.lookupBySteamAppIds).not.toHaveBeenCalled();
    expect(mockBulkUpdateItadIds).not.toHaveBeenCalled();
  });

  it('inserts price snapshots for games with valid price data', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([
        makeOverview('tf2', 9.99, 19.99, {
          historicalLow: 4.99,
          storeName: 'Steam',
          cut: 50,
          url: 'https://store.steam/app/440',
        }),
      ]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const result = await syncPrices();

    expect(mockInsertPriceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: 1,
        store: 'Steam',
        priceCurrent: 9.99,
        priceRegular: 19.99,
        discountPercent: 50,
        currency: 'USD',
        isHistoricalLow: false,
        historicalLowPrice: 4.99,
        dealScore: 75,
      })
    );
    expect(result.stats.succeeded).toBe(1);
    expect(result.stats.attempted).toBe(1);
  });

  it('detects all-time-low prices', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([
        makeOverview('tf2', 4.99, 19.99, { historicalLow: 4.99 }),
      ]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    expect(mockInsertPriceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ isHistoricalLow: true })
    );
  });

  it('detects below-ATL prices as historical low', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([
        makeOverview('tf2', 3.99, 19.99, { historicalLow: 4.99 }),
      ]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    expect(mockInsertPriceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ isHistoricalLow: true })
    );
  });

  it('skips games with no price data (currentPrice undefined)', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([{
        id: 'tf2',
        current: { price: {}, regular: {}, cut: 0, shop: { name: 'Steam' } },
        lowest: undefined,
        urls: {},
      }]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const result = await syncPrices();

    expect(mockInsertPriceSnapshot).not.toHaveBeenCalled();
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.succeeded).toBe(0);
  });

  it('returns early when all games fail ITAD ID resolution', async () => {
    const games = [makeGame(1, 440, 'TF2')]; // no itadGameId
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      lookupBySteamAppIds: vi.fn().mockResolvedValue(new Map()), // no results
      getOverview: vi.fn().mockResolvedValue([]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const result = await syncPrices();

    // itadToGame will be empty, so early return
    expect(result.stats).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
  });

  it('handles deal score calculation failure gracefully', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);
    mockCalculateDealScore.mockImplementation(() => { throw new Error('scoring error'); });

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([makeOverview('tf2', 9.99, 19.99)]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const result = await syncPrices();

    // Should still insert snapshot with undefined dealScore
    expect(mockInsertPriceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ dealScore: undefined })
    );
    expect(result.stats.succeeded).toBe(1);
  });

  it('stops processing when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const games = [
      makeGame(1, 440, 'TF2', 'tf2'),
      makeGame(2, 570, 'Dota 2', 'dota2'),
    ];
    mockGetGamesForPriceSync.mockReturnValue(games);

    mockInsertPriceSnapshot.mockImplementation(() => {
      controller.abort();
    });

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([
        makeOverview('tf2', 9.99, 19.99),
        makeOverview('dota2', 4.99, 29.99),
      ]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const result = await syncPrices(undefined, controller.signal);

    expect(result.stats.succeeded).toBe(1);
  });

  it('calls onProgress during processing', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([makeOverview('tf2', 9.99, 19.99)]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    const onProgress = vi.fn();
    await syncPrices(onProgress);

    expect(onProgress).toHaveBeenCalledWith(1, 1, { gameName: 'TF2' });
  });

  it('chains alert checking after successful price sync', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([makeOverview('tf2', 9.99, 19.99)]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    // Alert check is dynamically imported — verify it doesn't throw
    // (the mock above makes checkPriceAlerts a no-op)
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'success', 1, undefined, 1, 0);
  });

  it('propagates ITAD API errors and logs sync failure', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    mockGetITADClient.mockReturnValue(makeMockITADClient({
      getOverview: vi.fn().mockRejectedValue(new Error('ITAD rate limited')),
    }));

    await expect(syncPrices()).rejects.toThrow('ITAD rate limited');
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(42, 'error', 0, 'ITAD rate limited');
  });

  it('uses "Best Price" as default store when shop name is missing', async () => {
    const games = [makeGame(1, 440, 'TF2', 'tf2')];
    mockGetGamesForPriceSync.mockReturnValue(games);

    const mockClient = makeMockITADClient({
      getOverview: vi.fn().mockResolvedValue([{
        id: 'tf2',
        current: {
          price: { amount: 9.99, currency: 'USD' },
          regular: { amount: 19.99, currency: 'USD' },
          cut: 50,
          shop: {},
          url: undefined,
        },
        lowest: undefined,
        urls: { game: 'https://itad.com/game/tf2' },
      }]),
    });
    mockGetITADClient.mockReturnValue(mockClient);

    await syncPrices();

    expect(mockInsertPriceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        store: 'Best Price',
        url: 'https://itad.com/game/tf2',
      })
    );
  });
});
