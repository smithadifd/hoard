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
  upsertUserGame: vi.fn(),
  gameExists: vi.fn().mockReturnValue(true),
  updateManualHltbData: vi.fn(),
  setHltbExcluded: vi.fn(),
  getRatedGameCount: vi.fn().mockReturnValue(0),
}));

vi.mock('@/lib/onboarding/milestones', () => ({
  milestones: { firstTenRated: vi.fn() },
}));

import { getEnrichedGameById, updateUserGame, upsertUserGame, gameExists } from '@/lib/db/queries';
const mockGetGame = vi.mocked(getEnrichedGameById);
const mockUpdateGame = vi.mocked(updateUserGame);
const mockUpsertGame = vi.mocked(upsertUserGame);
const mockGameExists = vi.mocked(gameExists);

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
    mockGameExists.mockReturnValue(true);
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

  it('returns 404 when the game does not exist', async () => {
    mockUpdateGame.mockReturnValue(false);
    mockGameExists.mockReturnValue(false);

    const request = new Request('http://localhost/api/games/999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalInterest: 5 }),
    });

    const res = await PATCH(request, makeParams('999'));
    expect(res.status).toBe(404);
    expect(mockUpsertGame).not.toHaveBeenCalled();
  });

  it('creates a user_games row when wishlisting a looked-up game (no prior row)', async () => {
    // First updateUserGame call finds no row → false; game exists → upsert baseline,
    // then re-apply. Second call succeeds.
    mockUpdateGame.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockGameExists.mockReturnValue(true);

    const request = new Request('http://localhost/api/games/7', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isWishlisted: true, wishlistedLocally: true }),
    });

    const res = await PATCH(request, makeParams('7'));
    expect(res.status).toBe(200);
    expect(mockUpsertGame).toHaveBeenCalledWith(7, {}, 'test-user-id');
    expect(mockUpdateGame).toHaveBeenLastCalledWith(
      7,
      { isWishlisted: true, wishlistedLocally: true },
      'test-user-id'
    );
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

  it('sets a post-play enjoyment rating', async () => {
    mockUpdateGame.mockReturnValue(true);

    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enjoymentRating: 5 }),
    });

    const res = await PATCH(request, makeParams('1'));
    expect(res.status).toBe(200);
    expect(mockUpdateGame).toHaveBeenCalledWith(1, { enjoymentRating: 5 }, 'test-user-id');
  });

  it('clears an enjoyment rating with null', async () => {
    mockUpdateGame.mockReturnValue(true);

    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enjoymentRating: null }),
    });

    const res = await PATCH(request, makeParams('1'));
    expect(res.status).toBe(200);
    expect(mockUpdateGame).toHaveBeenCalledWith(1, { enjoymentRating: null }, 'test-user-id');
  });

  it('returns 400 for enjoyment rating out of range', async () => {
    const request = new Request('http://localhost/api/games/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enjoymentRating: 6 }),
    });

    const res = await PATCH(request, makeParams('1'));
    expect(res.status).toBe(400);
  });
});
