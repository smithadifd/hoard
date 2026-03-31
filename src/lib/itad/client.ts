/**
 * IsThereAnyDeal API v2 Client
 *
 * Handles price lookups, historical lows, and deal aggregation
 * across multiple authorized game stores.
 *
 * Docs: https://docs.isthereanydeal.com/
 * Rate limits: Heuristic-based, no hard limit published
 */

import { getEffectiveConfig } from '../config';
import type {
  ITADDeal,
  ITADGameLookup,
  ITADOverviewResponse,
  ITADOverviewPrice,
  ITADPricesV3Game,
  ITADSearchResult,
} from './types';

const ITAD_API_BASE = 'https://api.isthereanydeal.com';
const BATCH_SIZE = 200;

export class ITADClient {
  private async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the API key lazily so it always reflects the latest value
   * from the DB settings table, even if the user changes it mid-session.
   */
  private getApiKey(): string {
    const config = getEffectiveConfig();
    return config.itadApiKey;
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${ITAD_API_BASE}${endpoint}`);
    url.searchParams.set('key', this.getApiKey());
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchWithTimeout(url.toString());
    if (!response.ok) {
      throw new Error(`ITAD API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async postRequest<T>(
    endpoint: string,
    body: unknown,
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${ITAD_API_BASE}${endpoint}`);
    url.searchParams.set('key', this.getApiKey());
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
      const data = await this.request<ITADGameLookup>('/games/lookup/v1', {
        appid: appId.toString(),
      });
      return data?.found ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * Batch lookup: resolve multiple Steam App IDs to ITAD game IDs.
   * Uses individual GET requests (ITAD lookup/v1 is GET-only, no batch).
   * Returns a Map of steamAppId → ITAD game ID (string).
   */
  async lookupBySteamAppIds(
    appIds: number[],
    onProgress?: (done: number, total: number) => void
  ): Promise<Map<number, string>> {
    const results = new Map<number, string>();
    if (appIds.length === 0) return results;

    for (let i = 0; i < appIds.length; i++) {
      const appId = appIds[i];

      try {
        const data = await this.request<ITADGameLookup>('/games/lookup/v1', {
          appid: appId.toString(),
        });

        if (data?.found && data.game?.id) {
          results.set(appId, data.game.id);
        }
      } catch {
        // Individual lookup failed — skip this game
      }

      onProgress?.(i + 1, appIds.length);

      // Rate limit: ~200ms between requests
      if (i < appIds.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
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
   * Processes in batches of 200.
   *
   * Response from ITAD is: { prices: [...], bundles: [...] }
   * We unwrap and return just the prices array.
   */
  async getOverview(gameIds: string[]): Promise<ITADOverviewPrice[]> {
    if (gameIds.length === 0) return [];

    const allResults: ITADOverviewPrice[] = [];

    for (let i = 0; i < gameIds.length; i += BATCH_SIZE) {
      const batch = gameIds.slice(i, i + BATCH_SIZE);

      try {
        const data = await this.postRequest<ITADOverviewResponse>(
          '/games/overview/v2',
          batch
        );
        if (data?.prices && Array.isArray(data.prices)) {
          allResults.push(...data.prices);
        }
      } catch (error) {
        console.error(`ITAD overview batch failed at ${i}:`, error);
      }

      if (i + BATCH_SIZE < gameIds.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return allResults;
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
   * Get current prices across all stores for specific games.
   * Used for game detail page price comparison.
   * Processes in batches of 200.
   */
  async getPricesV3(gameIds: string[], country: string = 'US'): Promise<ITADPricesV3Game[]> {
    if (gameIds.length === 0) return [];

    const allResults: ITADPricesV3Game[] = [];

    for (let i = 0; i < gameIds.length; i += BATCH_SIZE) {
      const batch = gameIds.slice(i, i + BATCH_SIZE);

      try {
        const data = await this.postRequest<ITADPricesV3Game[]>(
          '/games/prices/v3',
          batch,
          { country }
        );
        if (Array.isArray(data)) {
          allResults.push(...data);
        }
      } catch (error) {
        console.error(`ITAD prices batch failed at ${i}:`, error);
      }

      if (i + BATCH_SIZE < gameIds.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return allResults;
  }

  /**
   * Batch lookup: Steam App IDs → ITAD game IDs → prices/historical lows.
   * Uses batch endpoints for efficiency.
   */
  async getPricesBySteamAppIds(appIds: number[]): Promise<Map<number, ITADOverviewPrice>> {
    const results = new Map<number, ITADOverviewPrice>();
    if (appIds.length === 0) return results;

    // Step 1: Batch lookup ITAD game IDs
    const idMap = await this.lookupBySteamAppIds(appIds);

    // Build reverse map: ITAD ID → Steam App ID
    const reverseMap = new Map<string, number>();
    const itadIds: string[] = [];
    for (const [steamAppId, itadId] of idMap) {
      reverseMap.set(itadId, steamAppId);
      itadIds.push(itadId);
    }

    if (itadIds.length === 0) return results;

    // Step 2: Batch get overview (prices + historical lows)
    const overviews = await this.getOverview(itadIds);

    for (const overview of overviews) {
      const steamAppId = reverseMap.get(overview.id);
      if (steamAppId !== undefined) {
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
