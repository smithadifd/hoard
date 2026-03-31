import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/scheduler', () => ({
  getTaskStatus: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  getLastSuccessfulSyncBySource: vi.fn(),
}));

import { getDb } from '@/lib/db';
import { getTaskStatus } from '@/lib/scheduler';
import { getLastSuccessfulSyncBySource } from '@/lib/db/queries';

const mockGetDb = vi.mocked(getDb);
const mockGetTaskStatus = vi.mocked(getTaskStatus);
const mockGetLastSync = vi.mocked(getLastSuccessfulSyncBySource);

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy when DB and scheduler are OK', async () => {
    mockGetDb.mockReturnValue({
      get: vi.fn().mockReturnValue({ ok: 1, count: 0 }),
    } as never);
    mockGetTaskStatus.mockReturnValue([{ name: 'test', schedule: '* * * * *', isRunning: false }]);
    mockGetLastSync.mockReturnValue({ steam_library: '2026-03-30T00:00:00Z' });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks.database).toBe(true);
    expect(body.checks.scheduler).toBe(true);
  });

  it('returns degraded when scheduler has no tasks', async () => {
    mockGetDb.mockReturnValue({
      get: vi.fn().mockReturnValue({ ok: 1, count: 0 }),
    } as never);
    mockGetTaskStatus.mockReturnValue([]);
    mockGetLastSync.mockReturnValue({});

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
  });

  it('returns unhealthy with 503 when DB throws', async () => {
    mockGetDb.mockImplementation(() => { throw new Error('DB connection failed'); });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('unhealthy');
  });
});
