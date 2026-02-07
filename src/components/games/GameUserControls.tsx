'use client';

import { useState } from 'react';
import { Eye, EyeOff, Star, Loader2 } from 'lucide-react';

interface GameUserControlsProps {
  gameId: number;
  interest: number;
  isWatchlisted: boolean;
  notes?: string;
}

export function GameUserControls({
  gameId,
  interest: initialInterest,
  isWatchlisted: initialWatchlisted,
  notes: initialNotes,
}: GameUserControlsProps) {
  const [interest, setInterest] = useState(initialInterest);
  const [isWatchlisted, setIsWatchlisted] = useState(initialWatchlisted);
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);

  const save = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleInterestChange = (value: number) => {
    setInterest(value);
    save({ personalInterest: value });
  };

  const toggleWatchlist = () => {
    const newValue = !isWatchlisted;
    setIsWatchlisted(newValue);
    save({ isWatchlisted: newValue });
  };

  const handleNotesBlur = () => {
    if (notes !== (initialNotes || '')) {
      save({ notes });
    }
  };

  return (
    <div className="space-y-4">
      {/* Interest Rating */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Interest</span>
          {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              onClick={() => handleInterestChange(value)}
              className={`p-1 transition-colors ${
                value <= interest ? 'text-yellow-500' : 'text-muted-foreground/30'
              } hover:text-yellow-400`}
            >
              <Star className="h-5 w-5 fill-current" />
            </button>
          ))}
        </div>
      </div>

      {/* Watchlist Toggle */}
      <button
        onClick={toggleWatchlist}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          isWatchlisted
            ? 'bg-steam-blue text-white hover:bg-steam-blue/90'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        }`}
      >
        {isWatchlisted ? (
          <>
            <EyeOff className="h-4 w-4" />
            Remove from Watchlist
          </>
        ) : (
          <>
            <Eye className="h-4 w-4" />
            Add to Watchlist
          </>
        )}
      </button>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleNotesBlur}
          placeholder="Add personal notes..."
          rows={3}
          className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>
    </div>
  );
}
