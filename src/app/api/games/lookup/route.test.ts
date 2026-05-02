import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

// Mock auth helper
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn().mockResolvedValue('test-user-id'),
}));

// Mock DB
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockReturningGet = vi.fn();

const mockUpdateWhere = vi.fn(() => ({ run: mockRun }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

const mockReturning = vi.fn(() => ({ get: mockReturningGet }));
const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockSelectFrom = vi.fn(() => ({ where: vi.fn(() => ({ get: mockGet })) }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

vi.mock('@/lib/db/index', () => ({
  getDb: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  })),
}));

// Mock Steam client
const mockGetAppDetails = vi.fn();
vi.mock('@/lib/steam/client', () => ({
  getSteamClient: vi.fn(() => ({
    getAppDetails: mockGetAppDetails,
  })),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
const mockRequireAuth = vi.mocked(requireUserIdFromRequest);

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/games/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/games/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue('test-user-id');
  });

  it('returns 401 when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Authentication required'));
    const res = await POST(makeRequest({ steamAppId: 440 }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid body (missing steamAppId)', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer steamAppId', async () => {
    const res = await POST(makeRequest({ steamAppId: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('returns existing game id when steamAppId already exists in DB', async () => {
    mockGet.mockReturnValue({ id: 42 });

    const res = await POST(makeRequest({ steamAppId: 440 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(42);
    // Should NOT call Steam API
    expect(mockGetAppDetails).not.toHaveBeenCalled();
    // Should update lastViewedAt
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns 404 when Steam returns null for unknown appId', async () => {
    mockGet.mockReturnValue(null); // not in DB
    mockGetAppDetails.mockResolvedValue(null);

    const res = await POST(makeRequest({ steamAppId: 99999 }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  it('inserts new game with source=lookup when appId not in DB', async () => {
    mockGet.mockReturnValue(null); // not in DB
    mockGetAppDetails.mockResolvedValue({
      name: 'Test Game',
      header_image: 'https://example.com/header.jpg',
      capsule_image: 'https://example.com/capsule.jpg',
      short_description: 'A test game',
      release_date: { date: '1 Jan, 2020', coming_soon: false },
      developers: ['Test Dev'],
      publishers: ['Test Pub'],
    });
    mockReturningGet.mockReturnValue({ id: 123 });

    const res = await POST(makeRequest({ steamAppId: 440 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(123);

    // Verify insert was called with source='lookup'
    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'lookup',
        title: 'Test Game',
        lastViewedAt: expect.any(Date),
      })
    );
  });
});
