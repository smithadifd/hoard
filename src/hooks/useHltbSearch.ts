'use client';

import { useState } from 'react';
import type { HLTBSearchResult } from '@/lib/hltb/types';

export type { HLTBSearchResult };

interface UseHltbSearchResult {
  results: HLTBSearchResult[];
  searching: boolean;
  searchError: string | null;
  search: (query: string) => Promise<void>;
  clearResults: () => void;
}

export function useHltbSearch(): UseHltbSearchResult {
  const [results, setResults] = useState<HLTBSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = async (query: string) => {
    setSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const resp = await fetch('/api/hltb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) {
        const errorBody = await resp.json().catch(() => null);
        setSearchError(`Search failed: ${errorBody?.error || 'unknown error'}`);
        return;
      }

      const json = await resp.json();
      const items: HLTBSearchResult[] = json.data?.results ?? [];
      setResults(items);
      if (items.length === 0) {
        setSearchError('No results found on HLTB');
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const clearResults = () => {
    setResults([]);
    setSearchError(null);
  };

  return { results, searching, searchError, search, clearResults };
}
