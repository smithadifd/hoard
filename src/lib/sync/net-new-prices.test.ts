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
  getGamesByIdsForPriceFetch: vi.fn(),
  bulkUpdateGameItadIds: vi.fn(),
  insertPriceSnapshot: vi.fn(),
  getScoringConfig: vi.fn(),
}));

import { fetchNetNewPrices } from './net-new-prices';
import { getEffectiveConfig } from '../config';
import { getITADClient } from '../itad/client';
import { calculateDealScore } from '../scoring/engine';
import {
  getGamesByIdsForPriceFetch,
  bulkUpdateGameItadIds,
  insertPriceSnapshot,
  getScoringConfig,
} from '../db/queries';

const mockGetConfig = vi.mocked(getEffectiveConfig);
const mockGetITADClient = vi.mocked(getITADClient);
const mockCalculateDealScore = vi.mocked(calculateDealScore);
const mockGetGames = vi.mocked(getGamesByIdsForPriceFetch);
const mockBulkUpdateItadIds = vi.mocked(bulkUpdateGameItadIds);
const mockInsertSnapshot = vi.mocked(insertPriceSnapshot);
const mockGetScoringConfig = vi.mocked(getScoringConfig);

function makeGame(id: number, steamAppId: number, itadGameId?: string) {
  return {
    id,
    steamAppId,
    title: `Game ${id}`,
    itadGameId: itadGameId ?? null,
    reviewScore: null,
    hltbMain: null,
    personalInterest: null,
  };
}

function makeOverview(id: string, currentPrice: number, regularPrice: number, historicalLow?: number, currency = 'USD') {
  return {
    id,
    current: {
      price: { amount: currentPrice, currency },
      regular: { amount: regularPrice, currency },
      cut: Math.round((1 - currentPrice / regularPrice) * 100),
      shop: { name: 'Steam' },
      url: 'https://store',
    },
    lowest: historicalLow !== undefined ? { price: { amount: historicalLow, currency } } : undefined,
    urls: { game: 'https://itad' },
  };
}

describe('fetchNetNewPrices', () => {
  const lookupBySteamAppIds = vi.fn();
  const getOverview = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({ itadApiKey: 'key' } as ReturnType<typeof getEffectiveConfig>);
    mockGetITADClient.mockReturnValue({ lookupBySteamAppIds, getOverview } as unknown as ReturnType<typeof getITADClient>);
    mockGetScoringConfig.mockReturnValue({ weights: {}, thresholds: {} } as ReturnType<typeof getScoringConfig>);
    mockCalculateDealScore.mockReturnValue({ overall: 50 } as ReturnType<typeof calculateDealScore>);
  });

  it('returns early with no work for an empty id list', async () => {
    const result = await fetchNetNewPrices([]);
    expect(result).toEqual({ snapshotted: 0 });
    expect(mockGetGames).not.toHaveBeenCalled();
  });

  it('returns early when no ITAD key is configured', async () => {
    mockGetConfig.mockReturnValue({ itadApiKey: undefined } as ReturnType<typeof getEffectiveConfig>);
    const result = await fetchNetNewPrices([1]);
    expect(result).toEqual({ snapshotted: 0 });
    expect(mockGetGames).not.toHaveBeenCalled();
  });

  it('resolves a missing ITAD id, fetches an overview, and inserts a snapshot', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 440)]);
    lookupBySteamAppIds.mockResolvedValue(new Map([[440, 'itad-abc']]));
    getOverview.mockResolvedValue([makeOverview('itad-abc', 9.99, 19.99, 4.99)]);

    const result = await fetchNetNewPrices([1]);

    expect(lookupBySteamAppIds).toHaveBeenCalledWith([440]);
    expect(mockBulkUpdateItadIds).toHaveBeenCalledWith([{ steamAppId: 440, itadGameId: 'itad-abc' }]);
    expect(getOverview).toHaveBeenCalledWith(['itad-abc']);
    expect(mockInsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 1, priceCurrent: 9.99, priceRegular: 19.99, historicalLowPrice: 4.99 }),
    );
    expect(result).toEqual({ snapshotted: 1 });
  });

  it('does not re-resolve when the game already has an ITAD id', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 440, 'itad-known')]);
    getOverview.mockResolvedValue([makeOverview('itad-known', 5, 10, 5)]);

    await fetchNetNewPrices([1]);

    expect(lookupBySteamAppIds).not.toHaveBeenCalled();
    expect(getOverview).toHaveBeenCalledWith(['itad-known']);
  });

  it('skips a foreign-currency price without writing a snapshot (honest USD boundary)', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 440, 'itad-gbp')]);
    getOverview.mockResolvedValue([makeOverview('itad-gbp', 8, 16, 4, 'GBP')]);

    const result = await fetchNetNewPrices([1]);

    expect(mockInsertSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ snapshotted: 0 });
  });

  it('snapshots nothing when the ITAD id cannot be resolved', async () => {
    mockGetGames.mockReturnValue([makeGame(1, 440)]);
    lookupBySteamAppIds.mockResolvedValue(new Map()); // unresolved

    const result = await fetchNetNewPrices([1]);

    expect(getOverview).not.toHaveBeenCalled();
    expect(mockInsertSnapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ snapshotted: 0 });
  });
});
