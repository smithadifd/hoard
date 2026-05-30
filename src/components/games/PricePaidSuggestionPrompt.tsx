'use client';

import { useState, useRef } from 'react';
import { Sparkles, Loader2, Check, Pencil, X } from 'lucide-react';

/**
 * PricePaidSuggestionPrompt — inline "we think you paid ~$X" nudge shown on an
 * owned game's detail page when Hoard estimated a price at purchase detection and
 * the user hasn't confirmed, edited, or dismissed it yet.
 *
 * Honesty tenet: the estimate is only ever a suggestion. It becomes the recorded
 * pricePaid solely on an explicit Confirm/Update; "Not now" dismisses it for good
 * without writing a price. Rides PATCH /api/games/:id (already demo-blocked).
 */
interface PricePaidSuggestionPromptProps {
  gameId: number;
  suggested: number;
}

export function PricePaidSuggestionPrompt({ gameId, suggested }: PricePaidSuggestionPromptProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        setDone(true);
        setTimeout(() => window.location.reload(), 600);
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  };

  const confirm = (value: number) => patch({ pricePaid: value });
  const dismiss = () => patch({ dismissPriceSuggestion: true });

  const handleUpdate = () => {
    const raw = inputRef.current?.value;
    const value = raw ? parseFloat(raw) : NaN;
    if (Number.isNaN(value) || value < 0) return;
    confirm(value);
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium">Did you pay around ${suggested.toFixed(2)}?</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Estimated from the last price we tracked before this game entered your library — it&apos;s only a guess.
        Confirm or correct it to unlock your realized $/hr. Assumed USD.
      </p>

      {editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              ref={inputRef}
              type="number"
              step="0.01"
              min="0"
              max="100000"
              defaultValue={suggested}
              className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleUpdate}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : null}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="px-3 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => confirm(suggested)}
            disabled={busy}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : null}
            Confirm ${suggested.toFixed(2)}
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            <Pencil className="h-3.5 w-3.5" /> Update
          </button>
          <button
            onClick={dismiss}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[44px]"
          >
            <X className="h-3.5 w-3.5" /> Not now
          </button>
        </div>
      )}
    </div>
  );
}
