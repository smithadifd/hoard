import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

vi.mock('@/lib/db/queries', () => ({
  updatePriceAlert: vi.fn(),
  deletePriceAlert: vi.fn(),
}));

import { updatePriceAlert, deletePriceAlert } from '@/lib/db/queries';
const mockUpdate = vi.mocked(updatePriceAlert);
const mockDelete = vi.mocked(deletePriceAlert);

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

describe('PATCH /api/alerts/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates alert with valid body', async () => {
    mockUpdate.mockReturnValue(true);

    const res = await PATCH(
      createRequest('/api/alerts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      }),
      makeParams('1')
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe('Alert updated');
    expect(mockUpdate).toHaveBeenCalledWith(1, { isActive: false });
  });

  it('returns 404 for non-existent alert', async () => {
    mockUpdate.mockReturnValue(false);

    const res = await PATCH(
      createRequest('/api/alerts/999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      }),
      makeParams('999')
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid ID', async () => {
    const res = await PATCH(
      createRequest('/api/alerts/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      }),
      makeParams('abc')
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid body', async () => {
    const res = await PATCH(
      createRequest('/api/alerts/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPrice: -1 }),
      }),
      makeParams('1')
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/alerts/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes alert successfully', async () => {
    mockDelete.mockReturnValue(true);

    const res = await DELETE(
      createRequest('/api/alerts/1', { method: 'DELETE' }),
      makeParams('1')
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe('Alert deleted');
  });

  it('returns 404 for non-existent alert', async () => {
    mockDelete.mockReturnValue(false);

    const res = await DELETE(
      createRequest('/api/alerts/999', { method: 'DELETE' }),
      makeParams('999')
    );

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid ID', async () => {
    const res = await DELETE(
      createRequest('/api/alerts/abc', { method: 'DELETE' }),
      makeParams('abc')
    );

    expect(res.status).toBe(400);
  });
});
