import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UpNextBucket } from '@/lib/backlog/upNext';
import {
  parseUpNextQueueResponse,
  fetchUpNextQueue,
  buildShownSignal,
  buildAcceptedSignal,
  postRecommendationSignal,
  emitShownOnce,
  shownSignalKey,
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

describe('buildShownSignal / buildAcceptedSignal', () => {
  it('builds the shown payload matching the route schema (gameId/bucket/reason/score per item)', () => {
    const items = [
      item({ gameId: 3, bucket: 'finish-soon', reason: 'close to done', score: 88 }),
      item({ gameId: 4, bucket: 'drop', reason: 'stalled', score: -5 }),
    ];
    expect(buildShownSignal(items)).toEqual({
      action: 'shown',
      items: [
        { gameId: 3, bucket: 'finish-soon', reason: 'close to done', score: 88 },
        { gameId: 4, bucket: 'drop', reason: 'stalled', score: -5 },
      ],
    });
  });

  it('builds the accepted payload identified by gameId', () => {
    expect(buildAcceptedSignal(42)).toEqual({ action: 'accepted', gameId: 42 });
  });

  it('keys a surfaced queue by its game ids', () => {
    expect(shownSignalKey([item({ gameId: 1 }), item({ gameId: 2 })])).toBe('1,2');
    expect(shownSignalKey([])).toBe('');
  });
});

describe('postRecommendationSignal', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs the given action + payload to the recommendations route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await postRecommendationSignal(buildAcceptedSignal(7));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/backlog/recommendations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ action: 'accepted', gameId: 7 });
  });

  it('swallows a non-ok response (no throw — best-effort)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'nope' }) }) as unknown as typeof fetch;
    await expect(postRecommendationSignal(buildAcceptedSignal(7))).resolves.toBeUndefined();
  });

  it('swallows a rejected fetch (no throw — best-effort)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(postRecommendationSignal(buildShownSignal([item()]))).resolves.toBeUndefined();
  });
});

describe('emitShownOnce', () => {
  it('fires exactly once across repeated calls with the same ref+queue (re-render refire guard)', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const ref = { current: null as string | null };
    const items = [item({ gameId: 1 }), item({ gameId: 2 })];

    expect(await emitShownOnce(items, ref, post)).toBe(true);
    expect(await emitShownOnce(items, ref, post)).toBe(false);
    expect(await emitShownOnce(items, ref, post)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(buildShownSignal(items));
  });

  it('collapses two near-concurrent invokes (StrictMode double-invoke) to a single POST', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const ref = { current: null as string | null };
    const items = [item({ gameId: 5 })];

    // Fire both before awaiting either — the ref is set synchronously before the
    // await, so the second call sees it already keyed and skips.
    const [a, b] = await Promise.all([
      emitShownOnce(items, ref, post),
      emitShownOnce(items, ref, post),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not fire for an empty queue', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const ref = { current: null as string | null };
    expect(await emitShownOnce([], ref, post)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('fires again when a different queue (new ids) is surfaced', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const ref = { current: null as string | null };
    expect(await emitShownOnce([item({ gameId: 1 })], ref, post)).toBe(true);
    expect(await emitShownOnce([item({ gameId: 9 })], ref, post)).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejected signal POST — resolves without throwing and leaves the queue untouched', async () => {
    const post = vi.fn().mockRejectedValue(new Error('signal failed'));
    const ref = { current: null as string | null };
    const items = [item({ gameId: 1 }), item({ gameId: 2 })];
    const snapshot = JSON.parse(JSON.stringify(items));

    // Never rejects even though the POST does — proves the display path (which
    // holds this same `items` array) is unaffected by a signal failure.
    await expect(emitShownOnce(items, ref, post)).resolves.toBe(true);
    expect(items).toEqual(snapshot);
  });

  it('GET/display path is independent of signal POST failure', async () => {
    const originalFetch = global.fetch;
    // GET succeeds; the signal POST (separate call) rejects — the queue the panel
    // renders comes only from fetchUpNextQueue and is unaffected.
    const queue = [item({ gameId: 1, bucket: 'continue' })];
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: { queue } }) })
      .mockRejectedValueOnce(new Error('signal down')) as unknown as typeof fetch;

    const displayed = await fetchUpNextQueue();
    await postRecommendationSignal(buildShownSignal(displayed)); // best-effort, rejects internally

    expect(displayed).toEqual(queue);
    global.fetch = originalFetch;
  });
});
