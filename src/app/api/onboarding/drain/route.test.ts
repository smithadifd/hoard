import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/sync/drain', () => ({
  startDrain: vi.fn(),
  cancelDrain: vi.fn(),
  getDrainProgressForUser: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { startDrain, cancelDrain, getDrainProgressForUser } from '@/lib/sync/drain';
import { POST, DELETE } from './route';

const mockRequireUser = vi.mocked(requireUserIdFromRequest);
const mockStartDrain = vi.mocked(startDrain);
const mockCancelDrain = vi.mocked(cancelDrain);
const mockGetProgress = vi.mocked(getDrainProgressForUser);

function createRequest(body?: unknown | string, method = 'POST'): NextRequest {
  return new NextRequest(new URL('/api/onboarding/drain', 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/onboarding/drain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await POST(createRequest({ mode: 'full' }));
    expect(res.status).toBe(401);
    expect(mockStartDrain).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(createRequest('{ bad'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid mode', async () => {
    const res = await POST(createRequest({ mode: 'turbo' }));
    expect(res.status).toBe(400);
    expect(mockStartDrain).not.toHaveBeenCalled();
  });

  it('starts the drain and returns the progress snapshot on success', async () => {
    mockStartDrain.mockReturnValue({ started: true } as never);
    mockGetProgress.mockReturnValue({ phase: 'running', percent: 0 } as never);

    const res = await POST(createRequest({ mode: 'full' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockStartDrain).toHaveBeenCalledWith({ mode: 'full', userId: 'test-user-id' });
    expect(body.data).toMatchObject({ phase: 'running' });
  });

  it('returns 409 when a drain is already running', async () => {
    mockStartDrain.mockReturnValue({ started: false, reason: 'already-running' } as never);
    const res = await POST(createRequest({ mode: 'lite' }));
    expect(res.status).toBe(409);
  });

  it('returns 403 in demo mode', async () => {
    mockStartDrain.mockReturnValue({ started: false, reason: 'demo-mode' } as never);
    const res = await POST(createRequest({ mode: 'lite' }));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/onboarding/drain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await DELETE(createRequest(undefined, 'DELETE'));
    expect(res.status).toBe(401);
  });

  it('cancels the drain and reports whether one was running', async () => {
    mockCancelDrain.mockReturnValue(true);
    const res = await DELETE(createRequest(undefined, 'DELETE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.cancelled).toBe(true);
  });
});
