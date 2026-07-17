import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  getUpNextQueue: vi.fn(),
  getOwnedGameIdSet: vi.fn(),
  recordRecommendationsShown: vi.fn(),
  recordRecommendationAccepted: vi.fn(),
  recordRecommendationDismissed: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import {
  getUpNextQueue,
  getOwnedGameIdSet,
  recordRecommendationsShown,
  recordRecommendationAccepted,
} from '@/lib/db/queries';
import { GET, POST } from './route';

const mockRequireUser = vi.mocked(requireUserIdFromRequest);
const mockGetQueue = vi.mocked(getUpNextQueue);
const mockOwnedSet = vi.mocked(getOwnedGameIdSet);
const mockShown = vi.mocked(recordRecommendationsShown);
const mockAccepted = vi.mocked(recordRecommendationAccepted);

function req(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest(new URL('/api/backlog/recommendations', 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue('test-user-id');
});

describe('GET /api/backlog/recommendations', () => {
  it('401s when auth fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await GET(req(undefined, 'GET'));
    expect(res.status).toBe(401);
  });

  it('returns the queue', async () => {
    mockGetQueue.mockReturnValue([{ gameId: 1, bucket: 'start-fresh' }] as never);
    const res = await GET(req(undefined, 'GET'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.queue).toHaveLength(1);
  });
});

describe('POST /api/backlog/recommendations — shown ownership guard', () => {
  it('rejects (400) a shown event for a game the user does not own', async () => {
    mockOwnedSet.mockReturnValue(new Set()); // owns nothing
    const res = await POST(
      req({ action: 'shown', items: [{ gameId: 7, bucket: 'start-fresh', reason: 'r' }] }),
    );
    expect(res.status).toBe(400);
    expect(mockShown).not.toHaveBeenCalled();
  });

  it('records shown events for owned games', async () => {
    mockOwnedSet.mockReturnValue(new Set([7]));
    const res = await POST(
      req({ action: 'shown', items: [{ gameId: 7, bucket: 'continue', reason: 'r', score: 5 }] }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.recorded).toBe(1);
    expect(mockShown).toHaveBeenCalledTimes(1);
  });

  it('accepts an action without an ownership pre-check (only ever acts on a prior shown event)', async () => {
    mockAccepted.mockReturnValue(true);
    const res = await POST(req({ action: 'accepted', gameId: 7 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.updated).toBe(true);
  });

  it('400s on an invalid body', async () => {
    const res = await POST(req({ action: 'nonsense' }));
    expect(res.status).toBe(400);
  });
});
