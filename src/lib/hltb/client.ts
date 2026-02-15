/**
 * HowLongToBeat Client
 *
 * Direct HTTP implementation of the HLTB search API.
 * The unofficial 'howlongtobeat' npm package is broken (HLTB changed their API),
 * so we implement the flow ourselves based on the working Python library:
 *
 * 1. Scrape HLTB homepage for JS bundle, extract search endpoint via regex
 * 2. GET {endpoint}/init?t={timestamp} to obtain auth token
 * 3. POST search with x-auth-token header and JSON payload
 *
 * Includes caching and graceful error handling so the app works without HLTB data.
 */

import type { HLTBResult } from './types';

const BASE_URL = 'https://howlongtobeat.com/';
const FALLBACK_SEARCH_PATH = 'api/finder/';
const REQUEST_TIMEOUT_MS = 15_000;

// Cached auth state — reused across searches until it expires/fails
let cachedSearchPath: string | null = null;
let cachedAuthToken: string | null = null;
let authFetchedAt = 0;
const AUTH_TTL_MS = 5 * 60 * 1000; // Refresh auth every 5 minutes

/**
 * Fetch the HLTB homepage, scan JS bundles to extract the search endpoint.
 * HLTB uses Next.js chunked builds — we search all /_next/ scripts for
 * a fetch() call with method: "POST" to /api/{something}.
 */
async function discoverSearchPath(): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout(BASE_URL, { headers: getHeaders() });
    if (!resp.ok) return null;

    const html = await resp.text();

    // Collect all Next.js script srcs
    const scriptSrcs = [...html.matchAll(/src="([^"]*\/_next\/[^"]*\.js)"/g)].map(m => m[1]);
    if (scriptSrcs.length === 0) return null;

    const pattern = /fetch\s*\(\s*["']\/api\/([a-zA-Z0-9_/]+)[^"']*["']\s*,\s*\{[\s\S]*?method:\s*["']POST["'][\s\S]*?\}/;

    for (const src of scriptSrcs) {
      const scriptUrl = src.startsWith('http') ? src : BASE_URL + src.replace(/^\//, '');
      const scriptResp = await fetchWithTimeout(scriptUrl, { headers: getHeaders() });
      if (!scriptResp.ok) continue;

      const content = await scriptResp.text();
      const match = pattern.exec(content);
      if (match && match[1] !== 'error') {
        const pathSuffix = match[1];
        const basePath = pathSuffix.includes('/') ? pathSuffix.split('/')[0] : pathSuffix;
        return `api/${basePath}/`;
      }
    }
  } catch (error) {
    console.warn('[HLTB] Failed to discover search path:', error);
  }
  return null;
}

/**
 * Get auth token from HLTB init endpoint.
 */
async function fetchAuthToken(searchPath: string): Promise<string | null> {
  try {
    const timestamp = Date.now();
    const initUrl = `${BASE_URL}${searchPath}init?t=${timestamp}`;
    const resp = await fetchWithTimeout(initUrl, { headers: getHeaders() });
    if (!resp.ok) return null;

    const data = await resp.json();
    return data.token || null;
  } catch (error) {
    console.warn('[HLTB] Failed to fetch auth token:', error);
    return null;
  }
}

/**
 * Ensure we have a valid search path and auth token, refreshing if stale.
 */
async function ensureAuth(): Promise<{ searchPath: string; authToken: string | null }> {
  const now = Date.now();
  if (cachedSearchPath && cachedAuthToken && (now - authFetchedAt) < AUTH_TTL_MS) {
    return { searchPath: cachedSearchPath, authToken: cachedAuthToken };
  }

  // Discover search path (or fall back)
  const discovered = await discoverSearchPath();
  cachedSearchPath = discovered || FALLBACK_SEARCH_PATH;

  // Get auth token
  cachedAuthToken = await fetchAuthToken(cachedSearchPath);
  authFetchedAt = now;

  return { searchPath: cachedSearchPath, authToken: cachedAuthToken };
}

function getHeaders(authToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'referer': BASE_URL,
    'origin': 'https://howlongtobeat.com',
  };
  if (authToken) {
    headers['x-auth-token'] = authToken;
  }
  return headers;
}

function buildSearchPayload(gameName: string): string {
  return JSON.stringify({
    searchType: 'games',
    searchTerms: gameName.split(/\s+/).filter(Boolean),
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { max: '', min: '' },
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  });
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute string similarity (SequenceMatcher-like ratio).
 */
function similarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;
  if (!al || !bl) return 0;

  // Simple character-overlap ratio (good enough for game title matching)
  const longer = al.length >= bl.length ? al : bl;
  const shorter = al.length < bl.length ? al : bl;

  let matches = 0;
  const longerChars = [...longer];
  for (const ch of shorter) {
    const idx = longerChars.indexOf(ch);
    if (idx !== -1) {
      longerChars.splice(idx, 1);
      matches++;
    }
  }
  return (2.0 * matches) / (al.length + bl.length);
}

export class HLTBClient {
  private cache = new Map<string, HLTBResult>();

  /**
   * Search HLTB for a game by title.
   * Returns the best match or null if not found.
   */
  async search(title: string): Promise<HLTBResult | null> {
    const cached = this.cache.get(title.toLowerCase());
    if (cached) return cached;

    try {
      return await this._searchInner(title, true);
    } catch (error) {
      console.error(`[HLTB] Search failed for "${title}":`, error);
      return null;
    }
  }

  private async _searchInner(title: string, allowRetry: boolean): Promise<HLTBResult | null> {
    const { searchPath, authToken } = await ensureAuth();
    const searchUrl = `${BASE_URL}${searchPath}`;
    const payload = buildSearchPayload(title);

    const resp = await fetchWithTimeout(searchUrl, {
      method: 'POST',
      headers: getHeaders(authToken),
      body: payload,
    });

    if (!resp.ok) {
      if ((resp.status === 401 || resp.status === 403 || resp.status === 404) && allowRetry) {
        authFetchedAt = 0;
        console.warn(`[HLTB] Search auth failed (${resp.status}) for "${title}", retrying with fresh auth...`);
        return this._searchInner(title, false);
      }
      console.warn(`[HLTB] Search returned ${resp.status} for "${title}"`);
      return null;
    }

    const json = await resp.json();
    const results = json.data;
    if (!Array.isArray(results) || results.length === 0) return null;

    // Find best match by similarity to search title
    let best: HLTBResult | null = null;
    let bestSimilarity = 0;

    for (const entry of results) {
      const nameSim = similarity(title, entry.game_name || '');
      const aliasSim = similarity(title, entry.game_alias || '');
      const sim = Math.max(nameSim, aliasSim);

      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        best = {
          id: String(entry.game_id),
          name: entry.game_name || '',
          description: '',
          imageUrl: entry.game_image ? `${BASE_URL}games/${entry.game_image}` : '',
          // API returns seconds — convert to hours
          gameplayMain: entry.comp_main ? Math.round((entry.comp_main / 3600) * 100) / 100 : 0,
          gameplayMainExtra: entry.comp_plus ? Math.round((entry.comp_plus / 3600) * 100) / 100 : 0,
          gameplayCompletionist: entry.comp_100 ? Math.round((entry.comp_100 / 3600) * 100) / 100 : 0,
          platforms: entry.profile_platform ? entry.profile_platform.split(', ') : [],
          similarity: sim,
        };
      }
    }

    if (best) {
      this.cache.set(title.toLowerCase(), best);
    }

    return best;
  }

  /**
   * Inner implementation for searchAll with optional retry on auth failure.
   */
  private async _searchAllInner(title: string, maxResults: number, allowRetry: boolean): Promise<HLTBResult[]> {
    const { searchPath, authToken } = await ensureAuth();
    const searchUrl = `${BASE_URL}${searchPath}`;
    const payload = buildSearchPayload(title);

    const resp = await fetchWithTimeout(searchUrl, {
      method: 'POST',
      headers: getHeaders(authToken),
      body: payload,
    });

    if (!resp.ok) {
      if ((resp.status === 401 || resp.status === 403 || resp.status === 404) && allowRetry) {
        authFetchedAt = 0;
        console.warn(`[HLTB] SearchAll auth failed (${resp.status}) for "${title}", retrying with fresh auth...`);
        return this._searchAllInner(title, maxResults, false);
      }
      console.warn(`[HLTB] SearchAll returned ${resp.status} for "${title}"`);
      return [];
    }

    const json = await resp.json();
    const results = json.data;
    if (!Array.isArray(results) || results.length === 0) return [];

    const mapped: HLTBResult[] = results.map((entry: Record<string, unknown>) => {
      const nameSim = similarity(title, (entry.game_name as string) || '');
      const aliasSim = similarity(title, (entry.game_alias as string) || '');
      const sim = Math.max(nameSim, aliasSim);

      return {
        id: String(entry.game_id),
        name: (entry.game_name as string) || '',
        description: '',
        imageUrl: entry.game_image ? `${BASE_URL}games/${entry.game_image}` : '',
        gameplayMain: entry.comp_main ? Math.round(((entry.comp_main as number) / 3600) * 100) / 100 : 0,
        gameplayMainExtra: entry.comp_plus ? Math.round(((entry.comp_plus as number) / 3600) * 100) / 100 : 0,
        gameplayCompletionist: entry.comp_100 ? Math.round(((entry.comp_100 as number) / 3600) * 100) / 100 : 0,
        platforms: entry.profile_platform ? (entry.profile_platform as string).split(', ') : [],
        similarity: sim,
      };
    });

    return mapped
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
  }

  /**
   * Search HLTB and return top N results sorted by similarity.
   * Unlike search() which returns only the best match, this returns multiple
   * candidates for the user to choose from.
   */
  async searchAll(title: string, maxResults: number = 5): Promise<HLTBResult[]> {
    try {
      return await this._searchAllInner(title, maxResults, true);
    } catch (error) {
      console.error(`[HLTB] SearchAll failed for "${title}":`, error);
      return [];
    }
  }

  /**
   * Batch search with polite rate limiting.
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
