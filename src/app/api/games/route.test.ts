import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

// Mock the queries module
vi.mock('@/lib/db/queries', () => ({
  getEnrichedGames: vi.fn(),
}));

import { getEnrichedGames } from '@/lib/db/queries';
const mockGetEnrichedGames = vi.mocked(getEnrichedGames);

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/games', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns games with default pagination', async () => {
    mockGetEnrichedGames.mockReturnValue({
      games: [{ id: 1, steamAppId: 440, title: 'TF2' }] as never,
      total: 1,
    });

    const res = await GET(createRequest('/api/games'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ total: 1, page: 1, pageSize: 24 });
  });

  it('passes search filter to query', async () => {
    mockGetEnrichedGames.mockReturnValue({ games: [], total: 0 });

    await GET(createRequest('/api/games?search=Cyberpunk'));

    expect(mockGetEnrichedGames).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Cyberpunk' }),
      1,
      24,
      'test-user-id'
    );
  });

  it('passes custom pagination', async () => {
    mockGetEnrichedGames.mockReturnValue({ games: [], total: 0 });

    await GET(createRequest('/api/games?page=3&pageSize=12'));

    expect(mockGetEnrichedGames).toHaveBeenCalledWith(
      expect.anything(),
      3,
      12,
      'test-user-id'
    );
  });

  it('returns 400 for invalid parameters', async () => {
    const res = await GET(createRequest('/api/games?page=0'));
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 for pageSize > 100', async () => {
    const res = await GET(createRequest('/api/games?pageSize=101'));
    expect(res.status).toBe(400);
  });

  it('returns 500 when query throws', async () => {
    mockGetEnrichedGames.mockImplementation(() => { throw new Error('DB error'); });

    const res = await GET(createRequest('/api/games'));
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to fetch games');
  });
});
