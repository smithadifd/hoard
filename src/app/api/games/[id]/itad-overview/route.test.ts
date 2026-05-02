import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

// Mock DB
const mockGet = vi.fn();
vi.mock('@/lib/db/index', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ get: mockGet })),
      })),
    })),
  })),
}));

// Mock ITAD client
const mockGetPrices = vi.fn();
vi.mock('@/lib/itad/client', () => ({
  getITADClient: vi.fn(() => ({
    getPricesBySteamAppIds: mockGetPrices,
  })),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
const mockRequireAuth = vi.mocked(requireUserIdFromRequest);

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/games/:id/itad-overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue('test-user-id');
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));
    const res = await GET(new Request('http://localhost/api/games/1/itad-overview'), makeParams('1'));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid game ID', async () => {
    const res = await GET(new Request('http://localhost/api/games/abc/itad-overview'), makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when game not found in DB', async () => {
    mockGet.mockReturnValue(null);
    const res = await GET(new Request('http://localhost/api/games/999/itad-overview'), makeParams('999'));
    expect(res.status).toBe(404);
  });

  it('returns null data gracefully when ITAD has no entry', async () => {
    // Use a unique steamAppId per test to avoid cache cross-contamination
    mockGet.mockReturnValue({ id: 1, steamAppId: 12345 });
    mockGetPrices.mockResolvedValue(new Map()); // no entry for this appId

    const res = await GET(new Request('http://localhost/api/games/1/itad-overview'), makeParams('1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeNull();
  });

  it('returns cached data on second call without re-fetching ITAD', async () => {
    const steamAppId = 54321; // unique to this test
    mockGet.mockReturnValue({ id: 1, steamAppId });
    const overviewData = {
      id: 'cached-game',
      current: {
        shop: { id: 1, name: 'Steam' },
        price: { amount: 5.99, amountInt: 599, currency: 'USD' },
        regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
        cut: 70,
        url: 'https://store.steampowered.com/app/54321',
        voucher: null,
        flag: null,
        drm: [],
        platforms: [],
        timestamp: '2024-01-01T00:00:00Z',
        expiry: null,
      },
      lowest: undefined,
      bundled: 0,
      urls: { game: 'https://isthereanydeal.com' },
    };
    mockGetPrices.mockResolvedValue(new Map([[steamAppId, overviewData]]));

    // First call populates cache
    await GET(new Request(`http://localhost/api/games/1/itad-overview`), makeParams('1'));
    // Second call should use cache (ITAD not called again)
    const res2 = await GET(new Request(`http://localhost/api/games/1/itad-overview`), makeParams('1'));
    const body2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(body2.data).not.toBeNull();
    // ITAD was only called once total for this steamAppId
    expect(mockGetPrices).toHaveBeenCalledTimes(1);
  });

  it('returns ITAD overview data when found', async () => {
    const overviewData = {
      id: 'test-game',
      current: {
        shop: { id: 1, name: 'Steam' },
        price: { amount: 9.99, amountInt: 999, currency: 'USD' },
        regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
        cut: 50,
        url: 'https://store.steampowered.com/app/440',
        voucher: null,
        flag: null,
        drm: [],
        platforms: [],
        timestamp: '2024-01-01T00:00:00Z',
        expiry: null,
      },
      lowest: {
        shop: { id: 1, name: 'Steam' },
        price: { amount: 4.99, amountInt: 499, currency: 'USD' },
        regular: { amount: 19.99, amountInt: 1999, currency: 'USD' },
        cut: 75,
        timestamp: '2023-06-15T00:00:00Z',
      },
      bundled: 0,
      urls: { game: 'https://isthereanydeal.com/game/test/info/' },
    };

    mockGet.mockReturnValue({ id: 1, steamAppId: 440 });
    mockGetPrices.mockResolvedValue(new Map([[440, overviewData]]));

    const res = await GET(new Request('http://localhost/api/games/1/itad-overview'), makeParams('1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).not.toBeNull();
    expect(body.data.current.price.amount).toBe(9.99);
    expect(body.data.lowest.price.amount).toBe(4.99);
  });

  it('returns null data (not 500) when ITAD throws', async () => {
    // Use a different steamAppId (99999) to avoid hitting the cache from the previous test
    mockGet.mockReturnValue({ id: 1, steamAppId: 99999 });
    mockGetPrices.mockRejectedValue(new Error('ITAD network error'));

    const res = await GET(new Request('http://localhost/api/games/1/itad-overview'), makeParams('1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeNull();
  });
});
