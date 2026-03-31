'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { useHltbSearch } from '@/hooks/useHltbSearch';
import type { HLTBSearchResult } from '@/hooks/useHltbSearch';

interface TriageHltbEditorProps {
  gameId: number;
  gameTitle: string;
  onSaved: () => void;
  compact?: boolean; // true for desktop row layout
}

export function TriageHltbEditor({ gameId, gameTitle, onSaved, compact }: TriageHltbEditorProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedResult, setSelectedResult] = useState<HLTBSearchResult | null>(null);
  const [showManual, setShowManual] = useState(false);
  const { results, searching, searchError, search, clearResults } = useHltbSearch();

  const mainRef = useRef<HTMLInputElement>(null);

  // Show manual entry when search returns no results
  useEffect(() => {
    if (searchError && results.length === 0) {
      setShowManual(true);
    }
  }, [searchError, results.length]);

  const handleSearch = async () => {
    setSelectedResult(null);
    await search(gameTitle);
  };

  const handleSelectResult = (result: HLTBSearchResult) => {
    setSelectedResult(result);
    clearResults();
  };

  const handleSave = async (main: number, mainExtra?: number, completionist?: number) => {
    setSaving(true);
    setSaved(false);

    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hltbMain: main,
          hltbMainExtra: mainExtra || null,
          hltbCompletionist: completionist || null,
        }),
      });

      if (resp.ok) {
        setSaved(true);
        setTimeout(onSaved, 600);
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const handleSaveManual = () => {
    const main = mainRef.current?.value ? parseFloat(mainRef.current.value) : null;
    if (!main || main <= 0) return;
    handleSave(main);
  };

  // Compact layout for desktop rows
  if (compact) {
    return (
      <div className="flex flex-col gap-2 w-full">
        {/* Initial state: search button */}
        {!selectedResult && !showManual && results.length === 0 && (
          <button
            onClick={handleSearch}
            disabled={searching}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {searching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Search HLTB
          </button>
        )}

        {/* Search error */}
        {searchError && (
          <span className="text-xs text-muted-foreground">{searchError}</span>
        )}

        {/* Search results */}
        {results.length > 0 && (
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSelectResult(r)}
                className="w-full flex items-center justify-between px-2 py-1 rounded text-left hover:bg-secondary/50 transition-colors text-xs"
              >
                <span className="truncate flex-1">{r.name}</span>
                <span className="text-muted-foreground ml-2 shrink-0">
                  {r.gameplayMain > 0 ? `${r.gameplayMain}h` : '\u2014'}
                </span>
              </button>
            ))}
            <button
              onClick={() => { clearResults(); setShowManual(true); }}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
            >
              Enter manually instead
            </button>
          </div>
        )}

        {/* Selected result confirmation */}
        {selectedResult && !saved && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground truncate flex-1">
              {selectedResult.name} &mdash; {selectedResult.gameplayMain}h
            </span>
            <button
              onClick={() => handleSave(
                selectedResult.gameplayMain,
                selectedResult.gameplayMainExtra,
                selectedResult.gameplayCompletionist,
              )}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => { setSelectedResult(null); clearResults(); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
          </div>
        )}

        {/* Manual entry */}
        {showManual && !saved && (
          <div className="flex items-center gap-2">
            <input
              ref={mainRef}
              type="number"
              step="0.5"
              min="0.5"
              max="10000"
              placeholder="Main story hours"
              className="w-28 px-2 py-1 rounded bg-background border border-input text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={handleSaveManual}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => { setShowManual(false); clearResults(); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
          </div>
        )}

        {/* Saved feedback */}
        {saved && (
          <span className="flex items-center gap-1 text-xs font-medium text-deal-great animate-in fade-in duration-200">
            <Check className="h-3 w-3" />
            Saved!
          </span>
        )}
      </div>
    );
  }

  // Mobile card layout
  return (
    <div className="space-y-3">
      {/* Initial state: search + manual buttons */}
      {!selectedResult && !showManual && results.length === 0 && (
        <div className="space-y-2">
          <button
            onClick={handleSearch}
            disabled={searching}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search HLTB
          </button>
          <button
            onClick={() => setShowManual(true)}
            className="w-full py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors min-h-[44px]"
          >
            Enter hours manually
          </button>
        </div>
      )}

      {/* Search error */}
      {searchError && (
        <p className="text-xs text-center text-muted-foreground">{searchError}</p>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Select the correct match:</p>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSelectResult(r)}
                className="w-full flex items-center justify-between p-3 rounded-md text-left hover:bg-secondary/50 transition-colors min-h-[44px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.gameplayMain > 0 ? `${r.gameplayMain}h main` : 'No data'}
                    {r.gameplayMainExtra > 0 && ` \u00B7 ${r.gameplayMainExtra}h extras`}
                  </div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded ml-2 shrink-0 ${
                  r.similarity >= 0.8 ? 'bg-deal-great/10 text-deal-great'
                    : r.similarity >= 0.5 ? 'bg-deal-good/10 text-deal-good'
                      : 'bg-deal-okay/10 text-deal-okay'
                }`}>
                  {Math.round(r.similarity * 100)}%
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={() => { clearResults(); setShowManual(true); }}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            None of these? Enter manually
          </button>
        </div>
      )}

      {/* Selected result — confirm and save */}
      {selectedResult && !saved && (
        <div className="space-y-2">
          <div className="p-3 rounded-md bg-secondary/50">
            <div className="text-sm font-medium">{selectedResult.name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {selectedResult.gameplayMain > 0 ? `${selectedResult.gameplayMain}h main story` : 'No main data'}
              {selectedResult.gameplayMainExtra > 0 && ` \u00B7 ${selectedResult.gameplayMainExtra}h extras`}
              {selectedResult.gameplayCompletionist > 0 && ` \u00B7 ${selectedResult.gameplayCompletionist}h completionist`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave(
                selectedResult.gameplayMain,
                selectedResult.gameplayMainExtra,
                selectedResult.gameplayCompletionist,
              )}
              disabled={saving || selectedResult.gameplayMain <= 0}
              className="flex-1 flex items-center justify-center gap-1 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </button>
            <button
              onClick={() => { setSelectedResult(null); }}
              className="px-4 py-3 rounded-md bg-secondary text-sm text-secondary-foreground hover:bg-secondary/80 transition-colors min-h-[44px]"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Manual entry */}
      {showManual && !saved && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Enter the main story duration in hours:
          </p>
          <input
            ref={mainRef}
            type="number"
            step="0.5"
            min="0.5"
            max="10000"
            placeholder="Main story hours (e.g. 12.5)"
            className="w-full px-3 py-2.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveManual}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </button>
            <button
              onClick={() => { setShowManual(false); clearResults(); }}
              className="px-4 py-3 rounded-md bg-secondary text-sm text-secondary-foreground hover:bg-secondary/80 transition-colors min-h-[44px]"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Saved feedback */}
      {saved && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-deal-great animate-in fade-in duration-200">
          <Check className="h-5 w-5" />
          Saved! Moving to next...
        </div>
      )}
    </div>
  );
}
