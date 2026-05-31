import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/notifications/queries', () => ({
  listNotifications: vi.fn(),
  markAllRead: vi.fn(),
  dismissAll: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { listNotifications, markAllRead, dismissAll } from '@/lib/notifications/queries';
import { GET, POST, DELETE } from './route';

const mockRequireUser = vi.mocked(requireUserIdFromRequest);
const mockList = vi.mocked(listNotifications);
const mockMarkAllRead = vi.mocked(markAllRead);
const mockDismissAll = vi.mocked(dismissAll);

function createRequest(body?: unknown | string, method = 'GET'): NextRequest {
  return new NextRequest(new URL('/api/notifications', 'http://localhost:3000'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  it('returns the notification list', async () => {
    mockList.mockReturnValue([{ id: 1, title: 'Hi' }] as never);
    const res = await GET(createRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.notifications).toHaveLength(1);
  });
});

describe('POST /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await POST(createRequest({ action: 'mark-all-read' }, 'POST'));
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await POST(createRequest('{ bad', 'POST'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unrecognized action', async () => {
    const res = await POST(createRequest({ action: 'delete-everything' }, 'POST'));
    expect(res.status).toBe(400);
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  it('marks all read and returns the updated count', async () => {
    mockMarkAllRead.mockReturnValue(4);
    const res = await POST(createRequest({ action: 'mark-all-read' }, 'POST'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.updated).toBe(4);
    expect(mockMarkAllRead).toHaveBeenCalledWith('test-user-id');
  });
});

describe('DELETE /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue('test-user-id');
  });

  it('returns 401 when authentication fails', async () => {
    mockRequireUser.mockRejectedValue(new Error('no session'));
    const res = await DELETE(createRequest(undefined, 'DELETE'));
    expect(res.status).toBe(401);
  });

  it('dismisses all visible notifications and returns the count', async () => {
    mockDismissAll.mockReturnValue(7);
    const res = await DELETE(createRequest(undefined, 'DELETE'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.dismissed).toBe(7);
  });
});
