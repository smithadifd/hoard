import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: vi.fn() };
});

import { readFileSync } from 'fs';

const mockRead = vi.mocked(readFileSync);

describe('GET /api/version', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the build id from .next/BUILD_ID', async () => {
    mockRead.mockReturnValue('abc123\n');
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ buildId: 'abc123' });
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
  });

  it('falls back to "dev" when BUILD_ID is unreadable', async () => {
    mockRead.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    delete process.env.NEXT_BUILD_ID;
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ buildId: 'dev' });
  });

  it('uses NEXT_BUILD_ID env when present and BUILD_ID file is missing', async () => {
    mockRead.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    process.env.NEXT_BUILD_ID = 'env-build-id';
    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ buildId: 'env-build-id' });
    delete process.env.NEXT_BUILD_ID;
  });
});
