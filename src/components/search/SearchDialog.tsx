'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, X, BookOpen, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import type { LibraryHit, SteamHit } from '@/app/api/search/route';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-12 h-7 rounded bg-surface-high animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-40 rounded bg-surface-high animate-pulse" />
        <div className="h-2.5 w-16 rounded bg-surface-high animate-pulse" />
      </div>
    </div>
  );
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ library: LibraryHit[]; steam: SteamHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAppId, setPendingAppId] = useState<number | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchResults = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      if (!res.ok) {
        setError('Search failed. Please try again.');
        setLoading(false);
        return;
      }
      const body = await res.json();
      setResults(body.data);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(value), 250);
  }, [fetchResults]);

  // Reset state when dialog closes (focus on open is handled via onOpenAutoFocus on Content)
  useEffect(() => {
    if (!open) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setQuery('');
      setResults(null);
      setError(null);
      setLoading(false);
      setLookupError(null);
      setPendingAppId(null);
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleLibraryClick = useCallback((hit: LibraryHit) => {
    onOpenChange(false);
    router.push(`/games/${hit.id}`);
  }, [onOpenChange, router]);

  const handleSteamClick = useCallback(async (hit: SteamHit) => {
    if (pendingAppId !== null) return; // already loading another result
    setPendingAppId(hit.appId);
    setLookupError(null);

    try {
      const res = await fetch('/api/games/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamAppId: hit.appId }),
      });

      const body = await res.json();

      if (!res.ok) {
        setLookupError((body as { error?: string }).error ?? 'Failed to load game');
        return;
      }

      const gameId = (body as { data: { id: number } }).data.id;
      onOpenChange(false);
      router.push(`/games/${gameId}`);
    } catch {
      setLookupError('Network error — please try again');
    } finally {
      setPendingAppId(null);
    }
  }, [pendingAppId, onOpenChange, router]);

  const hasResults = results && (results.library.length > 0 || results.steam.length > 0);
  const showEmpty = !loading && results !== null && !hasResults && query.length >= 2;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed z-50 top-0 left-0 right-0 mx-auto mt-0 sm:mt-[10vh] w-full sm:max-w-2xl max-h-screen sm:max-h-[80vh] flex flex-col bg-surface-base border-b sm:border border-white/[0.08] sm:rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Search games</Dialog.Title>

          {/* Search input bar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search your library and Steam..."
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => handleQueryChange('')}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors md:hidden">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>

          {/* Results area */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Hint text */}
            {!loading && query.length < 2 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search
              </p>
            )}

            {/* Error */}
            {error && (
              <p className="px-4 py-8 text-center text-sm text-destructive">{error}</p>
            )}

            {/* Loading skeletons */}
            {loading && (
              <div>
                <div className="px-4 py-2 text-xs font-label font-semibold text-muted-foreground uppercase tracking-wider">
                  In Your Library
                </div>
                <SkeletonRow />
                <SkeletonRow />
                <div className="px-4 py-2 mt-2 text-xs font-label font-semibold text-muted-foreground uppercase tracking-wider border-t border-white/[0.04]">
                  On Steam
                </div>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            )}

            {/* Empty state */}
            {showEmpty && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No matches found for &ldquo;{query}&rdquo;
              </p>
            )}

            {/* Results */}
            {!loading && hasResults && (
              <div>
                {/* Library section */}
                {results.library.length > 0 && (
                  <section>
                    <div className="px-4 py-2 flex items-center gap-2 text-xs font-label font-semibold text-muted-foreground uppercase tracking-wider">
                      <BookOpen className="h-3 w-3" />
                      In Your Library
                    </div>
                    <ul>
                      {results.library.map((hit) => (
                        <li key={hit.id}>
                          <button
                            onClick={() => handleLibraryClick(hit)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-high transition-colors text-left"
                          >
                            {/* Thumbnail */}
                            <div className="w-12 h-7 rounded bg-surface-lowest overflow-hidden flex-shrink-0">
                              {hit.headerImage ? (
                                <Image
                                  src={hit.headerImage}
                                  alt={hit.title}
                                  width={48}
                                  height={28}
                                  className="object-cover w-full h-full"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[9px]">
                                  N/A
                                </div>
                              )}
                            </div>

                            {/* Title + badge */}
                            <span className="flex-1 text-sm font-medium truncate">{hit.title}</span>

                            {/* Status badge */}
                            {hit.isOwned ? (
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-teal/20 text-teal border border-teal/30">
                                Owned
                              </span>
                            ) : hit.isWishlisted ? (
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-primary/20 text-primary border border-primary/30">
                                Wishlist
                              </span>
                            ) : hit.isWatchlisted ? (
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-gold/20 text-gold border border-gold/30">
                                Watchlist
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Steam section */}
                {results.steam.length > 0 && (
                  <section className={results.library.length > 0 ? 'border-t border-white/[0.04]' : ''}>
                    <div className="px-4 py-2 flex items-center gap-2 text-xs font-label font-semibold text-muted-foreground uppercase tracking-wider">
                      <ExternalLink className="h-3 w-3" />
                      On Steam
                    </div>
                    {lookupError && (
                      <p className="px-4 py-2 text-xs text-destructive">{lookupError}</p>
                    )}
                    <ul>
                      {results.steam.map((hit) => {
                        const isPending = pendingAppId === hit.appId;
                        const isDisabled = pendingAppId !== null;
                        return (
                          <li key={hit.appId}>
                            <button
                              onClick={() => void handleSteamClick(hit)}
                              disabled={isDisabled}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-surface-high cursor-pointer'}`}
                            >
                              {/* Tiny image */}
                              <div className="w-12 h-7 rounded bg-surface-lowest overflow-hidden flex-shrink-0">
                                {hit.tinyImage ? (
                                  <Image
                                    src={hit.tinyImage}
                                    alt={hit.name}
                                    width={48}
                                    height={28}
                                    className="object-cover w-full h-full"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[9px]">
                                    N/A
                                  </div>
                                )}
                              </div>

                              {/* Name + price */}
                              <span className="flex-1 text-sm font-medium truncate">{hit.name}</span>

                              {/* Price */}
                              {hit.price !== null && hit.price !== undefined && (
                                <span className="flex-shrink-0 text-xs text-muted-foreground mr-2">
                                  {hit.price.final === 0
                                    ? 'Free'
                                    : `$${(hit.price.final / 100).toFixed(2)}`}
                                </span>
                              )}

                              {/* Loading spinner or Lookup badge */}
                              {isPending ? (
                                <span className="flex-shrink-0 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-label font-semibold bg-surface-highest text-muted-foreground border border-white/[0.06]">
                                  Lookup
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>

          {/* Footer hint — desktop only */}
          <div className="hidden sm:flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.06] text-xs text-muted-foreground">
            <span>Esc to close</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
