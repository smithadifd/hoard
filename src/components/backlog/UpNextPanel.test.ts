import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UpNextBucket } from '@/lib/backlog/upNext';
import {
  parseUpNextQueueResponse,
  fetchUpNextQueue,
  UP_NEXT_BUCKET_BG,
  UP_NEXT_BUCKET_LABEL,
  type UpNextItem,
} from './UpNextPanel';

const ALL_BUCKETS: UpNextBucket[] = ['continue', 'finish-soon', 'start-fresh', 'drop'];

function item(overrides: Partial<UpNextItem> = {}): UpNextItem {
  return {
    gameId: overrides.gameId ?? 1,
    title: overrides.title ?? 'Hades',
    bucket: overrides.bucket ?? 'continue',
    reason: overrides.reason ?? 'In progress — 4h played. Pick up where you left off.',
    score: overrides.score ?? 42,
  };
}

describe('UP_NEXT_BUCKET_BG / UP_NEXT_BUCKET_LABEL', () => {
  it('maps every UpNextBucket to a badge color and a label', () => {
    for (const bucket of ALL_BUCKETS) {
      expect(UP_NEXT_BUCKET_BG[bucket]).toBeTruthy();
      expect(UP_NEXT_BUCKET_LABEL[bucket]).toBeTruthy();
    }
  });

  it('gives each bucket a distinct label', () => {
    const labels = ALL_BUCKETS.map((b) => UP_NEXT_BUCKET_LABEL[b]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('parseUpNextQueueResponse', () => {
  it('extracts the queue from the ApiResponse<{queue}> shape', () => {
    const items = [item({ gameId: 1, bucket: 'finish-soon' }), item({ gameId: 2, bucket: 'drop' })];
    expect(parseUpNextQueueResponse({ data: { queue: items } })).toEqual(items);
  });

  it('handles an empty queue (no recommendations) gracefully', () => {
    expect(parseUpNextQueueResponse({ data: { queue: [] } })).toEqual([]);
  });

  it('throws on a missing data envelope', () => {
    expect(() => parseUpNextQueueResponse({})).toThrow();
    expect(() => parseUpNextQueueResponse(null)).toThrow();
    expect(() => parseUpNextQueueResponse(undefined)).toThrow();
  });

  it('throws when queue is missing or not an array', () => {
    expect(() => parseUpNextQueueResponse({ data: {} })).toThrow();
    expect(() => parseUpNextQueueResponse({ data: { queue: 'nope' } })).toThrow();
    expect(() => parseUpNextQueueResponse({ error: 'boom' })).toThrow();
  });
});

describe('fetchUpNextQueue', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves with the queue — every bucket + reason preserved — on a 200', async () => {
    const items = [
      item({ gameId: 10, bucket: 'continue', reason: 'In progress — 4h played. Pick up where you left off.' }),
      item({ gameId: 11, bucket: 'finish-soon', reason: '~1.5h from the finish — one session to beat it.' }),
      item({ gameId: 12, bucket: 'start-fresh', reason: 'Never started · 92% reviews · ~8h — a clean pick.' }),
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { queue: items } }),
    }) as unknown as typeof fetch;

    const result = await fetchUpNextQueue();
    expect(result).toEqual(items);
    expect(global.fetch).toHaveBeenCalledWith('/api/backlog/recommendations');
  });

  it('resolves with an empty array — the empty state — when the queue has no picks', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { queue: [] } }),
    }) as unknown as typeof fetch;

    await expect(fetchUpNextQueue()).resolves.toEqual([]);
  });

  it('rejects on a non-ok response (the error path)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Authentication required' }),
    }) as unknown as typeof fetch;

    await expect(fetchUpNextQueue()).rejects.toThrow('401');
  });

  it('rejects on a malformed 200 body (the error path)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ oops: true }),
    }) as unknown as typeof fetch;

    await expect(fetchUpNextQueue()).rejects.toThrow();
  });

  it('rejects when the network call itself throws (the error path)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await expect(fetchUpNextQueue()).rejects.toThrow('network down');
  });
});
