'use client';

import { useState, useRef } from 'react';
import { DollarSign, Loader2, Check, Pencil, X } from 'lucide-react';

/**
 * PricePaidEditor - Inline editor for what the user paid for an owned game.
 * Optional; recording a price unlocks the realized-$/hr money lens on the
 * Value Received card. Rides PATCH /api/games/:id (already demo-blocked).
 */
interface PricePaidEditorProps {
  gameId: number;
  pricePaid?: number;
}

export function PricePaidEditor({ gameId, pricePaid }: PricePaidEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasPrice = pricePaid !== undefined && pricePaid > 0;

  const save = async (value: number | null) => {
    setSaving(true);
    setSaved(false);
    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricePaid: value }),
      });
      if (resp.ok) {
        setSaved(true);
        setTimeout(() => window.location.reload(), 700);
      }
    } catch {
      // Silent fail
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const raw = inputRef.current?.value;
    const value = raw ? parseFloat(raw) : null;
    if (value !== null && (Number.isNaN(value) || value < 0)) return;
    save(value);
  };

  if (!isEditing) {
    return (
      <div className="rounded-xl bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">What you paid</span>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Edit what you paid"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {hasPrice ? (
          <div className="text-sm">
            <span className="font-medium">${pricePaid!.toFixed(2)}</span>
            <span className="text-muted-foreground"> paid</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Optional — unlocks realized $/hr. Assumed USD.</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">What you paid</span>
        </div>
        <button
          aria-label="Cancel"
          onClick={() => setIsEditing(false)}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">$</span>
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          max="100000"
          aria-label="Price paid in dollars"
          defaultValue={hasPrice ? pricePaid : ''}
          placeholder="0.00"
          className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <p className="text-xs text-muted-foreground">Optional — unlocks realized $/hr. Assumed USD.</p>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Saved!' : 'Save'}
        </button>
        {hasPrice && (
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="flex items-center justify-center px-3 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 min-h-[44px]"
            title="Clear what you paid"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
