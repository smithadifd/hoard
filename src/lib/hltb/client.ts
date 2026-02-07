/**
 * HowLongToBeat Client
 *
 * Wraps the unofficial 'howlongtobeat' npm package with:
 * - Caching (game durations rarely change)
 * - Error handling for when the service is unavailable
 * - Rate limiting to avoid hammering the service
 *
 * NOTE: This is an unofficial integration. If the howlongtobeat
 * package breaks, the rest of the app continues to work - you
 * just won't get duration data until it's fixed.
 */

import type { HLTBResult } from './types';
import type { HowLongToBeatService as HLTBServiceType } from 'howlongtobeat';

// Lazy-load the howlongtobeat package to handle import failures gracefully
let hltbServiceInstance: HLTBServiceType | null = null;

async function getHLTBService() {
  if (!hltbServiceInstance) {
    try {
      const hltbModule = await import('howlongtobeat');
      hltbServiceInstance = new hltbModule.HowLongToBeatService();
    } catch (error) {
      console.warn('HowLongToBeat package not available:', error);
      return null;
    }
  }
  return hltbServiceInstance;
}

export class HLTBClient {
  private cache = new Map<string, HLTBResult>();

  /**
   * Search HLTB for a game by title.
   * Returns the best match or null if not found.
   */
  async search(title: string): Promise<HLTBResult | null> {
    // Check memory cache first
    const cached = this.cache.get(title.toLowerCase());
    if (cached) return cached;

    const service = await getHLTBService();
    if (!service) return null;

    try {
      const results = await service.search(title);

      if (!results || results.length === 0) return null;

      // Find best match by name similarity
      const result = results[0]; // Package returns sorted by relevance

      const mapped: HLTBResult = {
        id: result.id,
        name: result.name,
        description: result.description || '',
        imageUrl: result.imageUrl || '',
        gameplayMain: result.gameplayMain || 0,
        gameplayMainExtra: result.gameplayMainExtra || 0,
        gameplayCompletionist: result.gameplayCompletionist || 0,
        platforms: result.platforms || [],
        similarity: result.similarity || 0,
      };

      // Cache it
      this.cache.set(title.toLowerCase(), mapped);

      return mapped;
    } catch (error) {
      console.error(`HLTB search failed for "${title}":`, error);
      return null;
    }
  }

  /**
   * Batch search with polite rate limiting.
   * Used for backfilling HLTB data for existing library.
   */
  async batchSearch(
    titles: string[],
    delayMs: number = 1500,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, HLTBResult>> {
    const results = new Map<string, HLTBResult>();

    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      const result = await this.search(title);

      if (result) {
        results.set(title, result);
      }

      if (onProgress) {
        onProgress(i + 1, titles.length);
      }

      // Rate limiting - be gentle with HLTB
      if (i < titles.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }
}

// Singleton instance
let hltbClient: HLTBClient | null = null;

export function getHLTBClient(): HLTBClient {
  if (!hltbClient) {
    hltbClient = new HLTBClient();
  }
  return hltbClient;
}
