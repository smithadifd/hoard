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

import type {
  SteamOwnedGamesResponse,
  SteamWishlistResponse,
  SteamWishlistEntry,
  SteamAppDetails,
  SteamReviewSummary,
} from './types';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api';

export class SteamClient {
  private apiKey: string;
  private userId: string;

  constructor(apiKey: string, userId: string) {
    this.apiKey = apiKey;
    this.userId = userId;
  }

  /**
   * Fetch all owned games with playtime data.
   */
  async getOwnedGames(): Promise<SteamOwnedGamesResponse['response']> {
    const url = new URL(`${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('steamid', this.userId);
    url.searchParams.set('include_appinfo', '1');
    url.searchParams.set('include_played_free_games', '1');
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString());
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
    const url = new URL(`${STEAM_API_BASE}/IWishlistService/GetWishlist/v1/`);
    url.searchParams.set('steamid', this.userId);
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString());
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
    const url = `${STEAM_STORE_API}/appdetails?appids=${appId}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      const appData = data[appId.toString()];

      if (!appData?.success) return null;

      return appData.data;
    } catch {
      // JSON parse failure (rate-limited HTML response) or network error
      return null;
    }
  }

  /**
   * Get review summary for a game.
   */
  async getReviewSummary(appId: number): Promise<SteamReviewSummary['query_summary'] | null> {
    const url = `${STEAM_STORE_API}/appreviews/${appId}?json=1&purchase_type=all&num_per_page=0`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const data: SteamReviewSummary = await response.json();
      if (!data.success) return null;

      return data.query_summary;
    } catch {
      // JSON parse failure (rate-limited HTML response) or network error
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

/**
 * Create a SteamClient with the given credentials.
 * Use getEffectiveConfig() to get credentials from DB or env.
 */
export function createSteamClient(apiKey: string, userId: string): SteamClient {
  return new SteamClient(apiKey, userId);
}
