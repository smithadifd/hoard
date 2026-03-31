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
} from './types';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api';
const STEAM_STORE_BASE = 'https://store.steampowered.com';

export class SteamClient {
  private async fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<Response> {
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
