import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

// Mock the queries module
vi.mock('@/lib/db/queries', () => ({
  getEnrichedGameById: vi.fn(),
  updateUserGame: vi.fn(),
}));

import { getEnrichedGameById, updateUserGame } from '@/lib/db/queries';
const mockGetGame = vi.mocked(getEnrichedGameById);
const mockUpdateGame = vi.mocked(updateUserGame);

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/games/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns game for valid ID', async () => {
    const game = { id: 1, steamAppId: 440, title: 'TF2' };
    mockGetGame.mockReturnValue(game as never);

    const res = await GET(new Request('http://localhost/api/games/1'), makeParams('1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.title).toBe('TF2');
  });

  it('returns 404 for non-existent game', async () => {
    mockGetGame.mockReturnValue(null);

    const res = await GET(new Request('http://localhost/api/games/999'), makeParams('999'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric ID', async () => {
    const res = await GET(new Request('http://localhost/api/games/abc'), makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for zero ID', async () => {
    const res = await GET(new Request('http://localhost/api/games/0'), makeParams('0'));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/games/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates game with valid body', async () => {
    mockUpdateGame.mockReturnValue(true);

    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalInterest: 4 }),
    });

    const res = await PATCH(request, makeParams('1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe('Updated');
    expect(mockUpdateGame).toHaveBeenCalledWith(1, { personalInterest: 4 }, 'test-user-id');
  });

  it('returns 400 for invalid ID', async () => {
    const request = new Request('http://localhost/api/games/abc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalInterest: 3 }),
    });

    const res = await PATCH(request, makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty update body', async () => {
    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await PATCH(request, makeParams('1'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when game not found', async () => {
    mockUpdateGame.mockReturnValue(false);

    const request = new Request('http://localhost/api/games/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalInterest: 5 }),
    });

    const res = await PATCH(request, makeParams('999'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for interest out of range', async () => {
    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalInterest: 10 }),
    });

    const res = await PATCH(request, makeParams('1'));
    expect(res.status).toBe(400);
  });
});
