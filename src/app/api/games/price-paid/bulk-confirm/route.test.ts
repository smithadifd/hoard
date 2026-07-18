import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  bulkConfirmPricePaidSuggestions: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { bulkConfirmPricePaidSuggestions } from '@/lib/db/queries';
const mockAuth = vi.mocked(requireUserIdFromRequest);
const mockBulkConfirm = vi.mocked(bulkConfirmPricePaidSuggestions);

function createRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/games/price-paid/bulk-confirm', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/games/price-paid/bulk-confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue('test-user-id');
  });

  it('returns 401 without auth', async () => {
    mockAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await POST(createRequest({ entries: [{ gameId: 1 }] }));
    expect(res.status).toBe(401);
  });

  it('returns 200 and forwards entries to bulkConfirmPricePaidSuggestions', async () => {
    mockBulkConfirm.mockReturnValue({ applied: [1], skipped: [] });
    const res = await POST(createRequest({ entries: [{ gameId: 1 }] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ applied: [1], skipped: [] });
    expect(mockBulkConfirm).toHaveBeenCalledWith([{ gameId: 1 }], 'test-user-id');
  });

  it('passes an adjusted value through', async () => {
    mockBulkConfirm.mockReturnValue({ applied: [1], skipped: [] });
    await POST(createRequest({ entries: [{ gameId: 1, value: 4.99 }] }));
    expect(mockBulkConfirm).toHaveBeenCalledWith([{ gameId: 1, value: 4.99 }], 'test-user-id');
  });

  it('returns 400 for an empty entries array', async () => {
    const res = await POST(createRequest({ entries: [] }));
    expect(res.status).toBe(400);
    expect(mockBulkConfirm).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing gameId', async () => {
    const res = await POST(createRequest({ entries: [{ value: 4.99 }] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a negative value', async () => {
    const res = await POST(createRequest({ entries: [{ gameId: 1, value: -5 }] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest(new URL('/api/games/price-paid/bulk-confirm', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 when the query throws', async () => {
    mockBulkConfirm.mockImplementation(() => {
      throw new Error('db error');
    });
    const res = await POST(createRequest({ entries: [{ gameId: 1 }] }));
    expect(res.status).toBe(500);
  });
});
