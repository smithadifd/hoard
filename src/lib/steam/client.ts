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

import { getConfig } from '../config';
import type {
  SteamOwnedGamesResponse,
  SteamWishlistItem,
  SteamAppDetails,
  SteamReviewSummary,
} from './types';

const STEAM_API_BASE = 'https://api.steampowered.com';
const STEAM_STORE_API = 'https://store.steampowered.com/api';

export class SteamClient {
  private apiKey: string;
  private userId: string;

  constructor() {
    const config = getConfig();
    this.apiKey = config.steamApiKey;
    this.userId = config.steamUserId;
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
      throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
    }

    const data: SteamOwnedGamesResponse = await response.json();
    return data.response;
  }

  /**
   * Fetch the user's wishlist.
   * Note: Wishlist must be public or this will fail.
   */
  async getWishlist(): Promise<Record<string, SteamWishlistItem>> {
    const items: Record<string, SteamWishlistItem> = {};
    let page = 0;

    while (true) {
      const url = `https://store.steampowered.com/wishlist/profiles/${this.userId}/wishlistdata/?p=${page}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Steam Wishlist error: ${response.status}`);
      }

      const data = await response.json();

      // Empty response means no more pages
      if (!data || Object.keys(data).length === 0) break;

      Object.assign(items, data);
      page++;

      // Safety limit
      if (page > 20) break;

      // Be polite to Steam's servers
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return items;
  }

  /**
   * Get detailed app info from the Steam Store API.
   * Includes price, description, categories, etc.
   */
  async getAppDetails(appId: number): Promise<SteamAppDetails['data'] | null> {
    const url = `${STEAM_STORE_API}/appdetails?appids=${appId}`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data = await response.json();
    const appData = data[appId.toString()];

    if (!appData?.success) return null;

    return appData.data;
  }

  /**
   * Get review summary for a game.
   */
  async getReviewSummary(appId: number): Promise<SteamReviewSummary['query_summary'] | null> {
    const url = `${STEAM_STORE_API}/appreviews/${appId}?json=1&purchase_type=all&num_per_page=0`;
    const response = await fetch(url);

    if (!response.ok) return null;

    const data: SteamReviewSummary = await response.json();
    if (!data.success) return null;

    return data.query_summary;
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

// Singleton instance
let steamClient: SteamClient | null = null;

export function getSteamClient(): SteamClient {
  if (!steamClient) {
    steamClient = new SteamClient();
  }
  return steamClient;
}
