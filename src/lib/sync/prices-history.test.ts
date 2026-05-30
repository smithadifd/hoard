import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config', () => ({
  getEffectiveConfig: vi.fn(),
}));

vi.mock('../itad/client', () => ({
  getITADClient: vi.fn(),
  getAndResetItadApiCalls: vi.fn().mockReturnValue(0),
}));

vi.mock('../db/queries', () => ({
  bulkInsertPriceSnapshots: vi.fn(),
  createSyncLog: vi.fn(),
  completeSyncLog: vi.fn(),
  getGameItadInfo: vi.fn(),
}));

import { backfillPriceHistory, mapHistoryToSnapshots } from './prices-history';
import { getEffectiveConfig } from '../config';
import { getITADClient } from '../itad/client';
import {
  bulkInsertPriceSnapshots,
  createSyncLog,
  completeSyncLog,
  getGameItadInfo,
} from '../db/queries';
import type { ITADHistoryEntry } from '../itad/types';

const mockGetConfig = vi.mocked(getEffectiveConfig);
const mockGetITADClient = vi.mocked(getITADClient);
const mockBulkInsert = vi.mocked(bulkInsertPriceSnapshots);
const mockCreateSyncLog = vi.mocked(createSyncLog);
const mockCompleteSyncLog = vi.mocked(completeSyncLog);
const mockGetGameItadInfo = vi.mocked(getGameItadInfo);

function makeEvent(
  timestamp: string,
  shopName: string,
  price: number,
  regular: number,
  cut: number
): ITADHistoryEntry {
  return {
    timestamp,
    shop: { id: 1, name: shopName },
    deal: {
      price: { amount: price, amountInt: Math.round(price * 100), currency: 'USD' },
      regular: { amount: regular, amountInt: Math.round(regular * 100), currency: 'USD' },
      cut,
    },
  };
}

describe('mapHistoryToSnapshots', () => {
  it('maps ITAD events to snapshot insert rows', () => {
    const events = [
      makeEvent('2023-04-15T14:00:00Z', 'Steam', 9.99, 39.99, 75),
      makeEvent('2023-06-01T00:00:00Z', 'GOG', 19.99, 39.99, 50),
    ];
    const rows = mapHistoryToSnapshots(42, events);
    expect(rows).toEqual([
      {
        gameId: 42,
        store: 'Steam',
        priceCurrent: 9.99,
        priceRegular: 39.99,
        discountPercent: 75,
        currency: 'USD',
        snapshotDate: '2023-04-15',
      },
      {
        gameId: 42,
        store: 'GOG',
        priceCurrent: 19.99,
        priceRegular: 39.99,
        discountPercent: 50,
        currency: 'USD',
        snapshotDate: '2023-06-01',
      },
    ]);
  });

  it('skips events with missing price or shop data', () => {
    const events: ITADHistoryEntry[] = [
      makeEvent('2023-04-15T14:00:00Z', 'Steam', 9.99, 39.99, 75),
      // Missing shop name
      {
        timestamp: '2023-05-01T00:00:00Z',
        shop: { id: 2, name: '' },
        deal: {
          price: { amount: 5, amountInt: 500, currency: 'USD' },
          regular: { amount: 10, amountInt: 1000, currency: 'USD' },
          cut: 50,
        },
      },
    ];
    const rows = mapHistoryToSnapshots(1, events);
    expect(rows).toHaveLength(1);
    expect(rows[0].store).toBe('Steam');
  });

  it('drops foreign-currency events (regional storefronts) to keep the USD axis honest', () => {
    // Repro: GamesPlanet UK reports GBP prices even for a country=US query. A £31.99 deal
    // charted as "$31.99" dipped below the genuine USD all-time low. Only USD survives.
    const events: ITADHistoryEntry[] = [
      makeEvent('2026-05-22T00:00:00Z', 'GameBillet', 33.55, 49.99, 33), // USD — kept
      {
        timestamp: '2026-05-22T00:00:00Z',
        shop: { id: 9, name: 'GamesPlanet UK' },
        deal: {
          price: { amount: 31.99, amountInt: 3199, currency: 'GBP' },
          regular: { amount: 44.99, amountInt: 4499, currency: 'GBP' },
          cut: 29,
        },
      },
      {
        timestamp: '2026-05-22T00:00:00Z',
        shop: { id: 10, name: 'GamesPlanet DE' },
        deal: {
          price: { amount: 34.99, amountInt: 3499, currency: 'EUR' },
          regular: { amount: 49.99, amountInt: 4999, currency: 'EUR' },
          cut: 30,
        },
      },
    ];
    const rows = mapHistoryToSnapshots(42, events);
    expect(rows).toHaveLength(1);
    expect(rows[0].store).toBe('GameBillet');
    expect(rows[0].currency).toBe('USD');
  });

  it('returns an empty array for no events', () => {
    expect(mapHistoryToSnapshots(1, [])).toEqual([]);
  });
});

describe('backfillPriceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue({
      itadApiKey: 'test-key',
    } as ReturnType<typeof getEffectiveConfig>);
    mockCreateSyncLog.mockReturnValue(99);
  });

  it('fetches history, inserts snapshots, and completes the sync log', async () => {
    mockGetGameItadInfo.mockReturnValue({
      id: 5,
      itadGameId: 'itad-uuid-123',
      title: 'Hades',
    });
    const getPriceHistory = vi
      .fn()
      .mockResolvedValue([
        makeEvent('2023-04-15T14:00:00Z', 'Steam', 9.99, 24.99, 60),
      ]);
    mockGetITADClient.mockReturnValue({
      getPriceHistory,
    } as unknown as ReturnType<typeof getITADClient>);
    mockBulkInsert.mockReturnValue({ inserted: 1, skipped: 0 });

    const result = await backfillPriceHistory(5, { since: new Date('2012-01-01T00:00:00Z') });

    expect(getPriceHistory).toHaveBeenCalledWith('itad-uuid-123', {
      since: new Date('2012-01-01T00:00:00Z'),
    });
    expect(mockBulkInsert).toHaveBeenCalledWith([
      expect.objectContaining({ gameId: 5, store: 'Steam', snapshotDate: '2023-04-15' }),
    ]);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(99, 'success', 1, undefined, 1, 0, 0);
    expect(result).toEqual({
      gameId: 5,
      events: 1,
      inserted: 1,
      skipped: 0,
      syncLogId: 99,
    });
  });

  it('throws and logs an error when ITAD API key is missing', async () => {
    mockGetConfig.mockReturnValue({
      itadApiKey: '',
    } as ReturnType<typeof getEffectiveConfig>);

    await expect(backfillPriceHistory(1)).rejects.toThrow(/ITAD API Key/);
    expect(mockCreateSyncLog).not.toHaveBeenCalled();
  });

  it('throws when the game has no ITAD link yet', async () => {
    mockGetGameItadInfo.mockReturnValue({
      id: 7,
      itadGameId: null,
      title: 'Unmapped Game',
    });

    await expect(backfillPriceHistory(7)).rejects.toThrow(/not linked to ITAD/);
    expect(mockCreateSyncLog).not.toHaveBeenCalled();
  });

  it('marks the sync log as error when the ITAD call fails', async () => {
    mockGetGameItadInfo.mockReturnValue({
      id: 5,
      itadGameId: 'itad-uuid-123',
      title: 'Hades',
    });
    const getPriceHistory = vi.fn().mockRejectedValue(new Error('rate limited'));
    mockGetITADClient.mockReturnValue({
      getPriceHistory,
    } as unknown as ReturnType<typeof getITADClient>);

    await expect(backfillPriceHistory(5)).rejects.toThrow(/rate limited/);
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(99, 'error', 0, 'rate limited', undefined, undefined, 0);
  });
});
