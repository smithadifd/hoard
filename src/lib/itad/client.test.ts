import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ITADClient } from './client';

vi.mock('../config', () => ({
  getEffectiveConfig: () => ({
    itadApiKey: 'test-itad-key',
  }),
}));

describe('ITADClient', () => {
  let client: ITADClient;

  beforeEach(() => {
    client = new ITADClient();
    vi.restoreAllMocks();
  });

  describe('request error handling (GET)', () => {
    it('throws "ITAD API error: <status>" on a non-ok response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 429, statusText: 'Too Many Requests' })
      );

      // search() calls request() directly and does not swallow errors.
      await expect(client.search('hades')).rejects.toThrow('ITAD API error: 429');
    });

    it('parses a successful search payload', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 'abc', slug: 'hades', title: 'Hades', type: 'game', mature: false }]),
          { status: 200 }
        )
      );

      const results = await client.search('hades');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('abc');
    });
  });

  describe('postRequest error handling', () => {
    it('swallows a non-ok overview batch and returns an empty array', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Server Error' })
      );

      // getOverview wraps postRequest in a per-batch try/catch — the throw is
      // logged and the batch contributes nothing rather than aborting the run.
      const result = await client.getOverview(['itad-1']);
      expect(result).toEqual([]);
    });

    it('unwraps the prices array from a successful overview response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            prices: [{ id: 'itad-1', bundled: 0, urls: { game: 'https://x' } }],
            bundles: [],
          }),
          { status: 200 }
        )
      );

      const result = await client.getOverview(['itad-1']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('itad-1');
    });
  });

  describe('fetchWithTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborts the request after the 30s timeout', async () => {
      // fetch never resolves on its own; it only rejects when its signal aborts.
      vi.spyOn(global, 'fetch').mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            (init?.signal as AbortSignal)?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      );

      const promise = client.search('slow');
      // Surface the rejection without an unhandled-rejection warning.
      const assertion = expect(promise).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    });
  });

  describe('getPricesBySteamAppIds', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('keys the returned Map by steam appId across a multi-game batch', async () => {
      const lookup: Record<string, string | null> = {
        '10': 'itad-aaa',
        '20': 'itad-bbb',
        '30': null, // not found on ITAD — must be absent from the result Map
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : (input as URL).toString();

        if (url.includes('/games/lookup/v1')) {
          const appid = new URL(url).searchParams.get('appid')!;
          const itadId = lookup[appid];
          if (!itadId) {
            return new Response(JSON.stringify({ found: false }), { status: 200 });
          }
          return new Response(
            JSON.stringify({ found: true, game: { id: itadId } }),
            { status: 200 }
          );
        }

        if (url.includes('/games/overview/v2')) {
          return new Response(
            JSON.stringify({
              prices: [
                { id: 'itad-aaa', bundled: 0, urls: { game: 'a' } },
                { id: 'itad-bbb', bundled: 0, urls: { game: 'b' } },
              ],
              bundles: [],
            }),
            { status: 200 }
          );
        }

        return new Response('{}', { status: 200 });
      });

      const promise = client.getPricesBySteamAppIds([10, 20, 30]);
      await vi.runAllTimersAsync();
      const map = await promise;

      expect(map.size).toBe(2);
      // Correct appId → overview keying (an off-by-one in the reverse map would fail here).
      expect(map.get(10)?.id).toBe('itad-aaa');
      expect(map.get(20)?.id).toBe('itad-bbb');
      expect(map.has(30)).toBe(false);
    });

    it('returns an empty Map for an empty input without calling fetch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      const map = await client.getPricesBySteamAppIds([]);
      expect(map.size).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
