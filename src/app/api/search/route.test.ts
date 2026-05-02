import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

// Mock the DB module — return a chainable builder
const mockAll = vi.fn();
const mockLimit = vi.fn(() => ({ all: mockAll }));
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: mockInnerJoin })) }));

vi.mock('@/lib/db/index', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
  })),
}));

// Mock the Steam client
const mockSearchStore = vi.fn();
vi.mock('@/lib/steam/client', () => ({
  getSteamClient: vi.fn(() => ({
    searchStore: mockSearchStore,
  })),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
const mockRequireAuth = vi.mocked(requireUserIdFromRequest);

function createRequest(url: string): Request {
  return new Request(`http://localhost:3000${url}`);
}

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue('test-user-id');
    mockAll.mockReturnValue([]);
    mockSearchStore.mockResolvedValue([]);
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));

    const res = await GET(createRequest('/api/search?q=hades'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 when q is shorter than 2 characters', async () => {
    const res = await GET(createRequest('/api/search?q=h'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('returns 400 when q is missing', async () => {
    const res = await GET(createRequest('/api/search'));
    expect(res.status).toBe(400);
  });

  it('returns library and steam results in parallel', async () => {
    const libraryGame = {
      id: 1,
      steamAppId: 1145360,
      title: 'Hades',
      headerImage: 'https://cdn.akamai.steamstatic.com/steam/apps/1145360/header.jpg',
      isOwned: true,
      isWishlisted: false,
      isWatchlisted: false,
      sortPriority: 0,
    };

    const steamResult = {
      appId: 99999,
      name: 'Hades II',
      tinyImage: 'https://example.com/img.jpg',
      price: { initial: 2499, final: 2499, discountPercent: 0 },
    };

    mockAll.mockReturnValue([libraryGame]);
    mockSearchStore.mockResolvedValue([steamResult]);

    const res = await GET(createRequest('/api/search?q=hades'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.library).toHaveLength(1);
    expect(body.data.library[0].title).toBe('Hades');
    expect(body.data.steam).toHaveLength(1);
    expect(body.data.steam[0].name).toBe('Hades II');
  });

  it('deduplicates Steam results that are already in library', async () => {
    const libraryGame = {
      id: 1,
      steamAppId: 1145360,
      title: 'Hades',
      headerImage: null,
      isOwned: true,
      isWishlisted: false,
      isWatchlisted: false,
      sortPriority: 0,
    };

    // Steam returns Hades (already in library) plus another game
    const steamResults = [
      { appId: 1145360, name: 'Hades', tinyImage: null, price: null },
      { appId: 99999, name: 'Hades II', tinyImage: null, price: null },
    ];

    mockAll.mockReturnValue([libraryGame]);
    mockSearchStore.mockResolvedValue(steamResults);

    const res = await GET(createRequest('/api/search?q=hades'));
    const body = await res.json();

    expect(body.data.library).toHaveLength(1);
    // Hades (appId 1145360) should be removed from steam results
    expect(body.data.steam).toHaveLength(1);
    expect(body.data.steam[0].appId).toBe(99999);
  });

  it('returns library results with empty steam array when Steam fetch rejects', async () => {
    const libraryGame = {
      id: 1,
      steamAppId: 1145360,
      title: 'Hades',
      headerImage: null,
      isOwned: true,
      isWishlisted: false,
      isWatchlisted: false,
    };

    mockAll.mockReturnValue([libraryGame]);
    mockSearchStore.mockRejectedValue(new Error('network unreachable'));

    const res = await GET(createRequest('/api/search?q=hades'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.library).toHaveLength(1);
    expect(body.data.library[0].title).toBe('Hades');
    expect(body.data.steam).toEqual([]);
  });

  it('returns steam results when library query rejects', async () => {
    mockAll.mockImplementation(() => {
      throw new Error('DB locked');
    });
    mockSearchStore.mockResolvedValue([
      { appId: 99999, name: 'Hadestown', tinyImage: null, price: null },
    ]);

    const res = await GET(createRequest('/api/search?q=hades'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.library).toEqual([]);
    expect(body.data.steam).toHaveLength(1);
    expect(body.data.steam[0].appId).toBe(99999);
  });

  it('degrades gracefully and returns empty arrays when DB throws', async () => {
    mockAll.mockImplementation(() => {
      throw new Error('DB connection failed');
    });
    mockSearchStore.mockResolvedValue([]);

    const res = await GET(createRequest('/api/search?q=hades'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.library).toHaveLength(0);
    expect(body.data.steam).toHaveLength(0);
  });

  it('respects the limit parameter', async () => {
    mockAll.mockReturnValue([]);
    mockSearchStore.mockResolvedValue([]);

    const res = await GET(createRequest('/api/search?q=hades&limit=5'));
    expect(res.status).toBe(200);
    // Verify limit was passed through (mockLimit should have been called with 5)
    expect(mockLimit).toHaveBeenCalledWith(5);
  });
});
