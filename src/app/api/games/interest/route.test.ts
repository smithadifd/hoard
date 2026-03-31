import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  updateUserGame: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { updateUserGame } from '@/lib/db/queries';
const mockAuth = vi.mocked(requireUserIdFromRequest);
const mockUpdate = vi.mocked(updateUserGame);

function createRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/games/interest', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/games/interest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue('test-user-id');
  });

  it('returns 401 without auth', async () => {
    mockAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(createRequest({ gameId: 1, interest: 4 }));
    expect(res.status).toBe(401);
  });

  it('returns 200 for valid payload', async () => {
    mockUpdate.mockReturnValue(true);
    const res = await POST(createRequest({ gameId: 1, interest: 4 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.interest).toBe(4);
    expect(mockUpdate).toHaveBeenCalledWith(1, { personalInterest: 4 }, 'test-user-id');
  });

  it('returns 400 for missing gameId', async () => {
    const res = await POST(createRequest({ interest: 4 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for interest out of range', async () => {
    const res = await POST(createRequest({ gameId: 1, interest: 6 }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when game not found', async () => {
    mockUpdate.mockReturnValue(false);
    const res = await POST(createRequest({ gameId: 999, interest: 3 }));
    expect(res.status).toBe(404);
  });
});
