import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  getGameBackfillState: vi.fn(),
  bulkUpdateGameItadIds: vi.fn(),
  markPriceHistoryBackfilled: vi.fn(),
  incrementPriceHistoryMissCount: vi.fn(),
  PRICE_HISTORY_GIVE_UP_MISSES: 3,
}));

vi.mock('@/lib/itad/client', () => ({
  getITADClient: vi.fn(() => ({ lookupBySteamAppId: mockLookup })),
}));

vi.mock('@/lib/sync/prices-history', () => ({
  backfillPriceHistory: vi.fn(),
}));

import {
  getGameBackfillState,
  bulkUpdateGameItadIds,
  markPriceHistoryBackfilled,
  incrementPriceHistoryMissCount,
} from '@/lib/db/queries';
import { backfillPriceHistory } from '@/lib/sync/prices-history';

const mockState = vi.mocked(getGameBackfillState);
const mockBulkItad = vi.mocked(bulkUpdateGameItadIds);
const mockMarkDone = vi.mocked(markPriceHistoryBackfilled);
const mockMiss = vi.mocked(incrementPriceHistoryMissCount);
const mockBackfill = vi.mocked(backfillPriceHistory);
const mockLookup = vi.fn();

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}
function post(id: string) {
  return POST(new Request(`http://localhost/api/games/${id}/prices/ensure-history`, { method: 'POST' }), makeParams(id));
}

describe('POST /api/games/:id/prices/ensure-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the game does not exist', async () => {
    mockState.mockReturnValue(null);
    const res = await post('999');
    expect(res.status).toBe(404);
  });

  it('no-ops when already backfilled (does not hit ITAD)', async () => {
    mockState.mockReturnValue({
      id: 1, steamAppId: 440, itadGameId: 'tf2',
      priceHistoryBackfilledAt: new Date(), priceHistoryMissCount: 0,
    });
    const res = await post('1');
    const body = await res.json();
    expect(body.data.status).toBe('already-backfilled');
    expect(mockBackfill).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('no-ops once the miss-count give-up threshold is reached', async () => {
    mockState.mockReturnValue({
      id: 1, steamAppId: 440, itadGameId: null,
      priceHistoryBackfilledAt: null, priceHistoryMissCount: 3,
    });
    const res = await post('1');
    const body = await res.json();
    expect(body.data.status).toBe('gave-up');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('resolves ITAD link, backfills, and stamps the marker on success', async () => {
    mockState.mockReturnValue({
      id: 1, steamAppId: 440, itadGameId: null,
      priceHistoryBackfilledAt: null, priceHistoryMissCount: 0,
    });
    mockLookup.mockResolvedValue({ found: true, game: { id: 'tf2' } });
    mockBackfill.mockResolvedValue({ gameId: 1, events: 12, inserted: 10, skipped: 2, syncLogId: 1 });

    const res = await post('1');
    const body = await res.json();

    expect(mockBulkItad).toHaveBeenCalledWith([{ steamAppId: 440, itadGameId: 'tf2' }]);
    expect(mockBackfill).toHaveBeenCalledWith(1, expect.objectContaining({ since: expect.any(Date) }));
    expect(mockMarkDone).toHaveBeenCalledWith(1);
    expect(body.data.status).toBe('backfilled');
    expect(body.data.inserted).toBe(10);
  });

  it('increments miss count (and does NOT stamp backfilled) when ITAD has no match', async () => {
    mockState.mockReturnValue({
      id: 1, steamAppId: 440, itadGameId: null,
      priceHistoryBackfilledAt: null, priceHistoryMissCount: 0,
    });
    mockLookup.mockResolvedValue({ found: false, game: null });

    const res = await post('1');
    const body = await res.json();

    expect(body.data.status).toBe('no-itad-link');
    expect(mockMiss).toHaveBeenCalledWith(1);
    expect(mockMarkDone).not.toHaveBeenCalled();
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it('increments miss count when the backfill throws', async () => {
    mockState.mockReturnValue({
      id: 1, steamAppId: 440, itadGameId: 'tf2',
      priceHistoryBackfilledAt: null, priceHistoryMissCount: 1,
    });
    mockBackfill.mockRejectedValue(new Error('ITAD 500'));

    const res = await post('1');
    expect(res.status).toBe(500);
    expect(mockMiss).toHaveBeenCalledWith(1);
    expect(mockMarkDone).not.toHaveBeenCalled();
  });
});
