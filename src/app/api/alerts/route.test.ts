import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

vi.mock('@/lib/db/queries', () => ({
  getAllPriceAlertsWithGames: vi.fn(),
  upsertPriceAlert: vi.fn(),
}));

import { getAllPriceAlertsWithGames, upsertPriceAlert } from '@/lib/db/queries';
const mockGetAlerts = vi.mocked(getAllPriceAlertsWithGames);
const mockUpsertAlert = vi.mocked(upsertPriceAlert);

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

describe('GET /api/alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all alerts', async () => {
    const alerts = [
      { id: 1, gameId: 1, title: 'TF2', isActive: true },
      { id: 2, gameId: 2, title: 'Dota 2', isActive: false },
    ];
    mockGetAlerts.mockReturnValue(alerts as never);

    const res = await GET(createRequest('/api/alerts'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it('filters active alerts with ?active=true', async () => {
    const alerts = [
      { id: 1, gameId: 1, title: 'TF2', isActive: true },
      { id: 2, gameId: 2, title: 'Dota 2', isActive: false },
    ];
    mockGetAlerts.mockReturnValue(alerts as never);

    const res = await GET(createRequest('/api/alerts?active=true'));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].isActive).toBe(true);
  });
});

describe('POST /api/alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates alert with valid body', async () => {
    mockUpsertAlert.mockReturnValue(42);

    const res = await POST(createRequest('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 1, targetPrice: 9.99 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(42);
    expect(body.data.message).toBe('Alert saved');
  });

  it('returns 400 for missing gameId', async () => {
    const res = await POST(createRequest('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPrice: 10 }),
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for negative targetPrice', async () => {
    const res = await POST(createRequest('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 1, targetPrice: -5 }),
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer gameId', async () => {
    const res = await POST(createRequest('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 1.5 }),
    }));

    expect(res.status).toBe(400);
  });
});
