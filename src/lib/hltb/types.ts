/**
 * HowLongToBeat type definitions.
 * Uses the unofficial 'howlongtobeat' npm package.
 */

export interface HLTBResult {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  // Time in hours
  gameplayMain: number;
  gameplayMainExtra: number;
  gameplayCompletionist: number;
  // Additional metadata
  platforms: string[];
  similarity: number; // Match confidence 0-1
}

/**
 * Subset of HLTBResult used by search UI components.
 */
export interface HLTBSearchResult {
  id: string;
  name: string;
  gameplayMain: number;
  gameplayMainExtra: number;
  gameplayCompletionist: number;
  similarity: number;
}

/**
 * Cached HLTB data stored in our database.
 */
export interface HLTBCachedData {
  hltbId: number;
  main: number | null; // hours
  mainExtra: number | null; // hours
  completionist: number | null; // hours
  lastUpdated: string; // ISO date
}
