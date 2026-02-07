/**
 * IsThereAnyDeal API v2 Client
 *
 * Handles price lookups, historical lows, and deal aggregation
 * across multiple authorized game stores.
 *
 * Docs: https://docs.isthereanydeal.com/
 * Rate limits: Heuristic-based, no hard limit published
 */

import { getConfig } from '../config';
import type {
  ITADDeal,
  ITADGameLookup,
  ITADOverview,
  ITADSearchResult,
} from './types';

const ITAD_API_BASE = 'https://api.isthereanydeal.com';

export class ITADClient {
  private apiKey: string;

  constructor() {
    const config = getConfig();
    this.apiKey = config.itadApiKey;
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${ITAD_API_BASE}${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`ITAD API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Look up an ITAD game ID by Steam App ID.
   */
  async lookupBySteamAppId(appId: number): Promise<ITADGameLookup | null> {
    try {
      const data = await this.request<ITADGameLookup[]>('/games/lookup/v1', {
        appid: `app/${appId}`,
      });
      return data?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Search for games by title.
   */
  async search(query: string, limit: number = 20): Promise<ITADSearchResult[]> {
    return this.request<ITADSearchResult[]>('/games/search/v1', {
      title: query,
      results: limit.toString(),
    });
  }

  /**
   * Get current best prices and historical lows for games.
   * Accepts ITAD game IDs (not Steam App IDs).
   */
  async getOverview(gameIds: string[]): Promise<ITADOverview[]> {
    if (gameIds.length === 0) return [];

    return this.request<ITADOverview[]>('/games/overview/v2', {
      ids: gameIds.join(','),
    });
  }

  /**
   * Get current deals for games across all stores.
   */
  async getDeals(
    options: {
      limit?: number;
      offset?: number;
      sort?: 'price' | 'cut' | 'added';
    } = {}
  ): Promise<ITADDeal[]> {
    const params: Record<string, string> = {};
    if (options.limit) params.limit = options.limit.toString();
    if (options.offset) params.offset = options.offset.toString();
    if (options.sort) params.sort = options.sort;

    return this.request<ITADDeal[]>('/deals/v2', params);
  }

  /**
   * Get current prices for a specific game across all stores.
   */
  async getPrices(gameId: string, country: string = 'US'): Promise<ITADDeal[]> {
    return this.request<ITADDeal[]>('/games/prices/v2', {
      ids: gameId,
      country,
    });
  }

  /**
   * Batch lookup: Steam App IDs → ITAD game IDs → prices/historical lows.
   * Convenience method that chains lookups.
   */
  async getPricesBySteamAppIds(appIds: number[]): Promise<Map<number, ITADOverview>> {
    const results = new Map<number, ITADOverview>();

    // Step 1: Lookup ITAD game IDs
    const lookups = await Promise.all(
      appIds.map(async (appId) => ({
        appId,
        lookup: await this.lookupBySteamAppId(appId),
      }))
    );

    const idMap = new Map<string, number>(); // ITAD ID → Steam App ID
    const itadIds: string[] = [];

    for (const { appId, lookup } of lookups) {
      if (lookup?.found) {
        idMap.set(lookup.game.id, appId);
        itadIds.push(lookup.game.id);
      }
    }

    if (itadIds.length === 0) return results;

    // Step 2: Get overview (prices + historical lows)
    const overviews = await this.getOverview(itadIds);

    for (const overview of overviews) {
      const steamAppId = idMap.get(overview.id);
      if (steamAppId) {
        results.set(steamAppId, overview);
      }
    }

    return results;
  }
}

// Singleton instance
let itadClient: ITADClient | null = null;

export function getITADClient(): ITADClient {
  if (!itadClient) {
    itadClient = new ITADClient();
  }
  return itadClient;
}
