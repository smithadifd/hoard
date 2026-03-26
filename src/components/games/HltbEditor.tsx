'use client';

import { useState, useRef } from 'react';
import { Clock, Search, Loader2, Check, Pencil, X, RefreshCw, Ban } from 'lucide-react';

interface HLTBSearchResult {
  id: string;
  name: string;
  gameplayMain: number;
  gameplayMainExtra: number;
  gameplayCompletionist: number;
  similarity: number;
}

interface HltbEditorProps {
  gameId: number;
  gameTitle: string;
  hltbMain?: number;
  hltbMainExtra?: number;
  hltbCompletionist?: number;
  hltbManual?: boolean;
  hltbMissCount?: number;
}

export function HltbEditor({
  gameId,
  gameTitle,
  hltbMain,
  hltbMainExtra,
  hltbCompletionist,
  hltbManual,
  hltbMissCount,
}: HltbEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [results, setResults] = useState<HLTBSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const mainRef = useRef<HTMLInputElement>(null);
  const mainExtraRef = useRef<HTMLInputElement>(null);
  const completionistRef = useRef<HTMLInputElement>(null);

  const hasData = hltbMain !== undefined && hltbMain > 0;
  const isExcluded = hltbManual === true && !hasData;

  const handleToggleExclude = async () => {
    setSaving(true);
    try {
      await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hltbExcluded: !isExcluded }),
      });
      window.location.reload();
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const resp = await fetch('/api/hltb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: gameTitle }),
      });

      if (!resp.ok) {
        setSearchError('Search failed');
        return;
      }

      const json = await resp.json();
      setResults(json.data.results ?? []);
      if ((json.data.results ?? []).length === 0) {
        setSearchError('No results found on HLTB');
      }
    } catch {
      setSearchError('Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleUseResult = (result: HLTBSearchResult) => {
    if (mainRef.current) mainRef.current.value = result.gameplayMain > 0 ? String(result.gameplayMain) : '';
    if (mainExtraRef.current) mainExtraRef.current.value = result.gameplayMainExtra > 0 ? String(result.gameplayMainExtra) : '';
    if (completionistRef.current) completionistRef.current.value = result.gameplayCompletionist > 0 ? String(result.gameplayCompletionist) : '';
    setResults([]);
  };

  const handleSave = async () => {
    const main = mainRef.current?.value ? parseFloat(mainRef.current.value) : null;
    const mainExtra = mainExtraRef.current?.value ? parseFloat(mainExtraRef.current.value) : null;
    const completionist = completionistRef.current?.value ? parseFloat(completionistRef.current.value) : null;

    if (main === null && mainExtra === null && completionist === null) return;

    setSaving(true);
    setSaved(false);

    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hltbMain: main,
          hltbMainExtra: mainExtra,
          hltbCompletionist: completionist,
        }),
      });

      if (resp.ok) {
        setSaved(true);
        setTimeout(() => {
          setSaved(false);
          setIsEditing(false);
          window.location.reload();
        }, 1000);
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hltbMain: null,
          hltbMainExtra: null,
          hltbCompletionist: null,
        }),
      });
      window.location.reload();
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Duration (HLTB)</span>
          </div>
          {hasData && (
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Override HLTB duration data"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {hasData ? (
          <div className="space-y-1">
            <div className="text-sm">
              <span className="font-medium">{hltbMain}h</span>
              <span className="text-muted-foreground"> main story</span>
            </div>
            {hltbMainExtra !== undefined && hltbMainExtra > 0 && (
              <div className="text-xs text-muted-foreground">
                {hltbMainExtra}h main + extras
              </div>
            )}
            {hltbCompletionist !== undefined && hltbCompletionist > 0 && (
              <div className="text-xs text-muted-foreground">
                {hltbCompletionist}h completionist
              </div>
            )}
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
              hltbManual
                ? 'bg-yellow-500/10 text-yellow-500'
                : 'bg-steam-blue/10 text-steam-blue'
            }`}>
              {hltbManual ? 'Manual override' : 'Auto-synced'}
            </span>
          </div>
        ) : isExcluded ? (
          <div className="space-y-2">
            <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
              <Ban className="h-3 w-3 inline mr-1" />
              Excluded from HLTB sync
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleToggleExclude}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors min-h-[44px] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Resume sync
              </button>
              <button
                onClick={() => {
                  setIsEditing(true);
                  setTimeout(handleSearch, 100);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors min-h-[44px]"
              >
                <Search className="h-4 w-4" />
                Search HLTB
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Auto-sync couldn&#39;t find a match{hltbMissCount && hltbMissCount > 2 ? ` (${hltbMissCount} attempts)` : ''}. Search HLTB, enter hours manually, or skip.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsEditing(true);
                  setTimeout(handleSearch, 100);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors min-h-[44px]"
              >
                <Search className="h-4 w-4" />
                Search HLTB
              </button>
              <button
                onClick={handleToggleExclude}
                disabled={saving}
                className="flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors min-h-[44px] disabled:opacity-50"
                title="Stop HLTB sync for this game"
              >
                <Ban className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {hasData ? 'Override Duration' : 'Add Duration'}
          </span>
        </div>
        <button
          onClick={() => {
            setIsEditing(false);
            setResults([]);
            setSearchError(null);
          }}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Step 1: Search HLTB */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Step 1: Search HowLongToBeat to find a match, or skip to enter hours manually.
        </p>
        <button
          onClick={handleSearch}
          disabled={searching}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md bg-secondary text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Search &ldquo;{gameTitle.length > 30 ? gameTitle.slice(0, 30) + '...' : gameTitle}&rdquo;
        </button>
      </div>

      {/* Search Error */}
      {searchError && (
        <p className="text-xs text-muted-foreground">{searchError}</p>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Select a match to fill the fields below:</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {results.map((result) => (
              <button
                key={result.id}
                onClick={() => handleUseResult(result)}
                className="w-full flex items-center justify-between p-2 rounded-md text-left hover:bg-secondary/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{result.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {result.gameplayMain > 0 ? `${result.gameplayMain}h` : '\u2014'}
                    {result.gameplayMainExtra > 0 && ` / ${result.gameplayMainExtra}h`}
                    {result.gameplayCompletionist > 0 && ` / ${result.gameplayCompletionist}h`}
                  </div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  result.similarity >= 0.8 ? 'bg-deal-great/10 text-deal-great'
                    : result.similarity >= 0.5 ? 'bg-deal-good/10 text-deal-good'
                      : 'bg-deal-okay/10 text-deal-okay'
                }`}>
                  {Math.round(result.similarity * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Manual Input Fields */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Step 2: Review or adjust the hours, then save.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Main story</label>
          <input
            ref={mainRef}
            type="number"
            step="0.5"
            min="0"
            max="10000"
            defaultValue={hasData ? hltbMain : ''}
            placeholder="hours"
            className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Main + extras</label>
          <input
            ref={mainExtraRef}
            type="number"
            step="0.5"
            min="0"
            max="10000"
            defaultValue={hltbMainExtra !== undefined && hltbMainExtra > 0 ? hltbMainExtra : ''}
            placeholder="hours"
            className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground w-24 shrink-0">Completionist</label>
          <input
            ref={completionistRef}
            type="number"
            step="0.5"
            min="0"
            max="10000"
            defaultValue={hltbCompletionist !== undefined && hltbCompletionist > 0 ? hltbCompletionist : ''}
            placeholder="hours"
            className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saved ? 'Saved!' : 'Save Override'}
        </button>
        {hasData && hltbManual && (
          <button
            onClick={handleClear}
            disabled={saving}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 min-h-[44px]"
            title="Remove override and let auto-sync retry"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
      </div>

      {hasData && hltbManual && (
        <p className="text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 inline mr-1" />
          Remove override to let the nightly HLTB sync retry matching this game automatically.
        </p>
      )}

      {!hasData && (
        <p className="text-xs text-muted-foreground">
          Saving will mark this as a manual override. The nightly sync won&#39;t overwrite it.
        </p>
      )}
    </div>
  );
}
