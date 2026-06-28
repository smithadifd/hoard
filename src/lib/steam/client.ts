/**
 * Steam Web API Client
 *
 * Handles all interactions with the Steam API including:
 * - Fetching owned games with playtime
 * - Fetching wishlist
 * - Getting app details (prices, reviews, metadata)
 *
 * Docs: https://developer.valvesoftware.com/wiki/Steam_Web_API
 */

import { getEffectiveConfig } from '../config';
import type {
  SteamOwnedGamesResponse,
  SteamWishlistResponse,
  SteamWishlistEntry,
  SteamAppDetails,
  SteamReviewSummary,
  SteamReviewPage,
  SteamSearchResult,
} from './types';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api';
const STEAM_STORE_BASE = 'https://store.steampowered.com';

// Process-wide counter of external Steam API calls. Sync runs read & reset
// this at completion to stamp `sync_log.api_calls`.
//
// Known limitations (acceptable for run-level monitoring; revisit if
// per-endpoint accuracy is ever needed):
//   - Shared across concurrent syncs: if a manual /api/sync POST overlaps the
//     cron job for the same source, whichever finishes first drains the counter
//     and the other logs ~0. Aggregate across rows stays correct.
//   - Pre-try-block throws (e.g. createSyncLog DB error) bypass the reset.
//     Residue only persists if multiple consecutive syncs throw before
//     entering their try block — vanishingly rare in practice.
let apiCallCount = 0;

export function getAndResetSteamApiCalls(): number {
  const c = apiCallCount;
  apiCallCount = 0;
  return c;
}

export class SteamClient {
  private async fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<Response> {
    apiCallCount++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read credentials lazily so they always reflect the latest value
   * from the DB settings table, even if the user changes them mid-session.
   */
  private getCredentials(): { apiKey: string; userId: string } {
    const config = getEffectiveConfig();
    if (!config.steamApiKey || !config.steamUserId) {
      throw new Error('Steam API Key and User ID are required. Configure them in Settings.');
    }
    return { apiKey: config.steamApiKey, userId: config.steamUserId };
  }

  /**
   * Fetch all owned games with playtime data.
   */
  async getOwnedGames(): Promise<SteamOwnedGamesResponse['response']> {
    const { apiKey, userId } = this.getCredentials();
    const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', userId);
    url.searchParams.set('include_appinfo', '1');
    url.searchParams.set('include_played_free_games', '1');
    url.searchParams.set('format', 'json');

    const response = await this.fetchWithTimeout(url.toString());
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(
          'Steam API returned 400 Bad Request. Check that your Steam User ID is a 17-digit Steam64 ID ' +
          '(e.g., 76561198012345678) and your API key is valid at steamcommunity.com/dev/apikey'
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Steam API key is invalid or unauthorized. Verify your key at steamcommunity.com/dev/apikey'
        );
      }
      throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
    }

    const data: SteamOwnedGamesResponse = await response.json();
    if (!data.response?.games) {
      throw new Error(
        'Steam returned an empty library. Make sure your Steam profile visibility is set to Public ' +
        '(Steam > Profile > Edit Profile > Privacy Settings > Game details: Public)'
      );
    }
    return data.response;
  }

  /**
   * Fetch the user's wishlist via IWishlistService/GetWishlist/v1.
   * Returns only appid, priority, and date_added per item.
   * Wishlist must be public or this will return empty.
   */
  async getWishlist(): Promise<SteamWishlistEntry[]> {
    const { userId } = this.getCredentials();
    const url = new URL(`${STEAM_API_BASE}/IWishlistService/GetWishlist/v1/`);
    url.searchParams.set('steamid', userId);
    url.searchParams.set('format', 'json');

    const response = await this.fetchWithTimeout(url.toString());
    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(
          'Steam Wishlist API returned 400 Bad Request. Check that your Steam User ID is a 17-digit Steam64 ID.'
        );
      }
      throw new Error(`Steam Wishlist error: ${response.status} ${response.statusText}`);
    }

    const data: SteamWishlistResponse = await response.json();
    return data.response?.items ?? [];
  }

  /**
   * Get detailed app info from the Steam Store API.
   * Includes price, description, categories, etc.
   */
  async getAppDetails(appId: number): Promise<SteamAppDetails['data'] | null> {
    const url = `${STEAM_STORE_API}/appdetails?appids=${appId}&l=english`;

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.log(`[Steam] getAppDetails(${appId}): HTTP ${response.status}`);
        return null;
      }

      const text = await response.text();
      try {
        const data = JSON.parse(text);
        const appData = data[appId.toString()];

        if (!appData?.success) {
          console.log(`[Steam] getAppDetails(${appId}): success=false`);
          return null;
        }

        return appData.data;
      } catch {
        console.log(`[Steam] getAppDetails(${appId}): JSON parse failed, response starts with: ${text.substring(0, 100)}`);
        return null;
      }
    } catch (err) {
      console.log(`[Steam] getAppDetails(${appId}): fetch error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Get review summary for a game.
   */
  async getReviewSummary(appId: number): Promise<SteamReviewSummary['query_summary'] | null> {
    const url = `${STEAM_STORE_BASE}/appreviews/${appId}?json=1&purchase_type=all&num_per_page=0`;

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.log(`[Steam] getReviewSummary(${appId}): HTTP ${response.status}`);
        return null;
      }

      const text = await response.text();
      try {
        const data: SteamReviewSummary = JSON.parse(text);
        if (!data.success) {
          console.log(`[Steam] getReviewSummary(${appId}): success=false`);
          return null;
        }

        return data.query_summary;
      } catch {
        console.log(`[Steam] getReviewSummary(${appId}): JSON parse failed, response starts with: ${text.substring(0, 100)}`);
        return null;
      }
    } catch (err) {
      console.log(`[Steam] getReviewSummary(${appId}): fetch error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Sample per-review total playtimes for a game from the paginated
   * /appreviews endpoint. Returns an array of `playtime_forever` values (in
   * minutes), dropping zero/missing entries, across up to `maxReviews` of the
   * most-recent reviews (all languages). Returns null on any failure — the
   * caller decides how to handle a missing sample. Never throws.
   *
   * No API key required (Store endpoint). Walks the `cursor` token; stops on an
   * empty page, a repeated cursor, or once the cap is reached.
   */
  async getReviewPlaytimes(appId: number, maxReviews = 200): Promise<number[] | null> {
    const playtimes: number[] = [];
    const seenCursors = new Set<string>();
    let cursor = '*';

    try {
      while (playtimes.length < maxReviews) {
        const url =
          `${STEAM_STORE_BASE}/appreviews/${appId}?json=1&num_per_page=100` +
          `&filter=recent&language=all&purchase_type=all&cursor=${encodeURIComponent(cursor)}`;

        const response = await this.fetchWithTimeout(url);
        if (!response.ok) {
          console.log(`[Steam] getReviewPlaytimes(${appId}): HTTP ${response.status}`);
          break;
        }

        const text = await response.text();
        let data: SteamReviewPage;
        try {
          data = JSON.parse(text);
        } catch {
          console.log(`[Steam] getReviewPlaytimes(${appId}): JSON parse failed, response starts with: ${text.substring(0, 100)}`);
          break;
        }

        if (!data.success) {
          console.log(`[Steam] getReviewPlaytimes(${appId}): success=false`);
          break;
        }

        const reviews = data.reviews ?? [];
        if (reviews.length === 0) break;

        for (const review of reviews) {
          const minutes = review.author?.playtime_forever ?? 0;
          if (minutes > 0) playtimes.push(minutes);
        }

        // Advance the cursor; stop if it's missing or repeats (last page).
        const next = data.cursor;
        if (!next || seenCursors.has(next)) break;
        seenCursors.add(next);
        cursor = next;
      }

      return playtimes;
    } catch (err) {
      console.log(`[Steam] getReviewPlaytimes(${appId}): fetch error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Search the Steam store by keyword.
   * Uses the unofficial storesearch endpoint — no API key required.
   * Returns [] on any failure, never throws to callers.
   */
  async searchStore(term: string, limit: number = 10): Promise<SteamSearchResult[]> {
    const url = `${STEAM_STORE_API}/storesearch/?term=${encodeURIComponent(term)}&l=en&cc=us`;

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        console.log(`[Steam] searchStore("${term}"): HTTP ${response.status}`);
        return [];
      }

      const text = await response.text();
      try {
        const data = JSON.parse(text) as {
          items?: Array<{
            id: number;
            name: string;
            tiny_image?: string;
            price?: { initial: number; final: number; discount_percent: number };
          }>;
        };

        const items = data.items ?? [];
        return items.slice(0, limit).map((item) => ({
          appId: item.id,
          name: item.name,
          tinyImage: item.tiny_image ?? null,
          price: item.price
            ? {
                initial: item.price.initial,
                final: item.price.final,
                discountPercent: item.price.discount_percent,
              }
            : null,
        }));
      } catch {
        console.log(`[Steam] searchStore("${term}"): JSON parse failed, response starts with: ${text.substring(0, 100)}`);
        return [];
      }
    } catch (err) {
      console.log(`[Steam] searchStore("${term}"): fetch error: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  /**
   * Batch fetch app details with rate limiting.
   * Steam Store API has a ~200 requests per 5 minutes limit.
   */
  async batchGetAppDetails(
    appIds: number[],
    delayMs: number = 1500
  ): Promise<Map<number, SteamAppDetails['data']>> {
    const results = new Map<number, SteamAppDetails['data']>();

    for (const appId of appIds) {
      const details = await this.getAppDetails(appId);
      if (details) {
        results.set(appId, details);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return results;
  }
}

let steamClient: SteamClient | null = null;

/**
 * Get the singleton SteamClient instance.
 * Credentials are read lazily from config on each API call.
 */
export function getSteamClient(): SteamClient {
  if (!steamClient) {
    steamClient = new SteamClient();
  }
  return steamClient;
}
