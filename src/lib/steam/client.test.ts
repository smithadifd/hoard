import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SteamClient } from './client';

vi.mock('../config', () => ({
  getEffectiveConfig: () => ({
    steamApiKey: 'test-api-key',
    steamUserId: '76561198012345678',
  }),
}));

describe('SteamClient', () => {
  let client: SteamClient;

  beforeEach(() => {
    client = new SteamClient();
    vi.restoreAllMocks();
  });

  describe('getOwnedGames', () => {
    it('parses valid response correctly', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          response: {
            game_count: 2,
            games: [
              { appid: 440, name: 'Team Fortress 2', playtime_forever: 1000 },
              { appid: 570, name: 'Dota 2', playtime_forever: 500 },
            ],
          },
        }), { status: 200 })
      );

      const result = await client.getOwnedGames();
      expect(result.games).toHaveLength(2);
      expect(result.games[0].appid).toBe(440);
    });

    it('throws helpful error on 401', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 401, statusText: 'Unauthorized' })
      );

      await expect(client.getOwnedGames()).rejects.toThrow('API key is invalid');
    });

    it('throws helpful error on 400', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 400, statusText: 'Bad Request' })
      );

      await expect(client.getOwnedGames()).rejects.toThrow('Steam64 ID');
    });

    it('throws when library is empty (profile not public)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ response: {} }), { status: 200 })
      );

      await expect(client.getOwnedGames()).rejects.toThrow('empty library');
    });

    it('throws on generic HTTP error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(client.getOwnedGames()).rejects.toThrow('Steam API error: 500');
    });
  });

  describe('getWishlist', () => {
    it('parses valid response correctly', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          response: {
            items: [
              { appid: 100, priority: 0, date_added: 1700000000 },
              { appid: 200, priority: 1, date_added: 1700001000 },
            ],
          },
        }), { status: 200 })
      );

      const result = await client.getWishlist();
      expect(result).toHaveLength(2);
      expect(result[0].appid).toBe(100);
    });

    it('handles empty wishlist', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ response: {} }), { status: 200 })
      );

      const result = await client.getWishlist();
      expect(result).toEqual([]);
    });

    it('throws on 400', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 400, statusText: 'Bad Request' })
      );

      await expect(client.getWishlist()).rejects.toThrow('Steam64 ID');
    });
  });

  describe('getAppDetails', () => {
    it('parses valid response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          '440': {
            success: true,
            data: { name: 'Team Fortress 2', type: 'game' },
          },
        }), { status: 200 })
      );

      const result = await client.getAppDetails(440);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Team Fortress 2');
    });

    it('returns null on rate limit (HTML response)', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('<html>Rate limited</html>', { status: 200 })
      );

      const result = await client.getAppDetails(440);
      expect(result).toBeNull();
    });

    it('returns null on non-200 response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const result = await client.getAppDetails(440);
      expect(result).toBeNull();
    });

    it('returns null when success is false', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          '440': { success: false },
        }), { status: 200 })
      );

      const result = await client.getAppDetails(440);
      expect(result).toBeNull();
    });
  });

  describe('searchStore', () => {
    it('maps storesearch response to SteamSearchResult[]', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          total: 2,
          items: [
            {
              id: 1145360,
              name: 'Hades',
              tiny_image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/capsule_sm_120.jpg',
              price: { initial: 2499, final: 1249, discount_percent: 50 },
            },
            {
              id: 1145361,
              name: 'Hades II',
              tiny_image: null,
            },
          ],
        }), { status: 200 })
      );

      const results = await client.searchStore('hades');
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        appId: 1145360,
        name: 'Hades',
        tinyImage: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/capsule_sm_120.jpg',
        price: { initial: 2499, final: 1249, discountPercent: 50 },
      });
      expect(results[1].price).toBeNull();
      expect(results[1].tinyImage).toBeNull();
    });

    it('respects the limit parameter', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Game ${i + 1}` }));
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ items }), { status: 200 })
      );

      const results = await client.searchStore('game', 5);
      expect(results).toHaveLength(5);
    });

    it('returns [] on HTTP error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 503 })
      );

      const results = await client.searchStore('hades');
      expect(results).toEqual([]);
    });

    it('returns [] on network error', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const results = await client.searchStore('hades');
      expect(results).toEqual([]);
    });

    it('returns [] on invalid JSON', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('<html>Not JSON</html>', { status: 200 })
      );

      const results = await client.searchStore('hades');
      expect(results).toEqual([]);
    });
  });

  describe('getReviewSummary', () => {
    it('parses valid response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          success: 1,
          query_summary: {
            total_positive: 90,
            total_negative: 10,
            review_score_desc: 'Very Positive',
          },
        }), { status: 200 })
      );

      const result = await client.getReviewSummary(440);
      expect(result).not.toBeNull();
      expect(result!.review_score_desc).toBe('Very Positive');
    });

    it('returns null on network error', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await client.getReviewSummary(440);
      expect(result).toBeNull();
    });
  });
});
