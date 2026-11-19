// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInfiniteScroll } from './useInfiniteScroll';
import type { EnrichedGame } from '@/types';

function game(id: number): EnrichedGame {
  return { id } as EnrichedGame;
}

const ids = (games: EnrichedGame[]) => games.map((g) => g.id);

let intersect: ((isIntersecting: boolean) => void) | null = null;

class MockIntersectionObserver {
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    intersect = (isIntersecting) => cb([{ isIntersecting }]);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

const fetchMock = vi.fn();

function pageResponse(data: EnrichedGame[], total: number) {
  return { ok: true, json: async () => ({ data, meta: { total } }) };
}

const buildUrl = (page: number) => '/api/games?page=' + page;

beforeEach(() => {
  intersect = null;
  fetchMock.mockReset();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(initialGames: EnrichedGame[], initialTotal: number) {
  const hook = renderHook(
    (props: { initialGames: EnrichedGame[]; initialTotal: number }) =>
      useInfiniteScroll({ ...props, buildUrl }),
    { initialProps: { initialGames, initialTotal } },
  );
  act(() => {
    hook.result.current.sentinelRef(document.createElement('div'));
  });
  return hook;
}

async function trigger() {
  await act(async () => {
    intersect?.(true);
  });
}

describe('useInfiniteScroll', () => {
  it('fetches the next page when the sentinel intersects and appends the games', async () => {
    fetchMock.mockResolvedValueOnce(pageResponse([game(3), game(4)], 4));
    const { result } = setup([game(1), game(2)], 4);
    expect(result.current.hasMore).toBe(true);

    await trigger();

    expect(fetchMock).toHaveBeenCalledWith('/api/games?page=2');
    expect(ids(result.current.games)).toEqual([1, 2, 3, 4]);
    expect(result.current.total).toBe(4);
    expect(result.current.hasMore).toBe(false);
  });

  it('does not fetch when everything is already loaded', async () => {
    setup([game(1), game(2)], 2);
    await trigger();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops fetching once the loaded count reaches the total', async () => {
    fetchMock.mockResolvedValueOnce(pageResponse([game(3)], 3));
    setup([game(1), game(2)], 3);
    await trigger();
    await trigger();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resets games and total when the initial props change', () => {
    const { result, rerender } = setup([game(1)], 5);
    rerender({ initialGames: [game(10), game(11)], initialTotal: 7 });
    expect(ids(result.current.games)).toEqual([10, 11]);
    expect(result.current.total).toBe(7);
    expect(result.current.hasMore).toBe(true);
  });

  it('restarts paging at page 2 after a reset', async () => {
    fetchMock.mockResolvedValue(pageResponse([game(99)], 10));
    const { rerender } = setup([game(1)], 10);
    await trigger(); // page 2
    await trigger(); // page 3
    expect(fetchMock).toHaveBeenLastCalledWith('/api/games?page=3');

    rerender({ initialGames: [game(20)], initialTotal: 10 });
    await trigger();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/games?page=2');
  });

  it('applies the new total to the fetch guard after a reset', async () => {
    fetchMock.mockResolvedValue(pageResponse([game(99)], 10));
    const { rerender } = setup([game(1)], 10);
    await trigger(); // loads 2 of 10
    fetchMock.mockClear();

    // New filter result is fully loaded: the guard must use the new numbers.
    rerender({ initialGames: [game(20), game(21), game(22)], initialTotal: 3 });
    await trigger();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the guard allow fetching after the totals grow on reset', async () => {
    fetchMock.mockResolvedValue(pageResponse([game(99)], 9));
    const { rerender } = setup([game(1), game(2)], 2);
    await trigger();
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ initialGames: [game(1), game(2)], initialTotal: 9 });
    await trigger();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
