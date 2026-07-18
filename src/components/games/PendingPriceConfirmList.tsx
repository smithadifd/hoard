'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Pencil, Sparkles, X } from 'lucide-react';
import type { PendingPriceSuggestion } from '@/lib/db/queries';

interface PendingPriceConfirmListProps {
  initialPending: PendingPriceSuggestion[];
}

interface BulkConfirmApiEntry {
  gameId: number;
  value?: number;
}

/**
 * Bulk-confirm UI for the price-paid suggestion backlog. Renders every owned
 * game with an unconfirmed estimate and lets the user accept all, accept a
 * selection, or adjust individual amounts before writing — the backlog
 * counterpart to the per-game confirm/adjust prompt (PricePaidSuggestionPrompt).
 *
 * Honesty tenet carries over unchanged: nothing here writes `pricePaid` except
 * an explicit accept or adjust. "Not now" dismisses a row for good (reuses the
 * existing single-game dismiss action) without ever writing a price.
 */
export function PendingPriceConfirmList({ initialPending }: PendingPriceConfirmListProps) {
  const [items, setItems] = useState(initialPending);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggleSelected = (gameId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.gameId)));
  };

  const removeResolved = (resolvedIds: number[]) => {
    const resolved = new Set(resolvedIds);
    setItems((prev) => prev.filter((i) => !resolved.has(i.gameId)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of resolvedIds) next.delete(id);
      return next;
    });
  };

  const submitBulkConfirm = async (entries: BulkConfirmApiEntry[]) => {
    if (entries.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const resp = await fetch('/api/games/price-paid/bulk-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (resp.ok) {
        const { data } = await resp.json();
        const applied: number[] = data?.applied ?? [];
        const skipped: number[] = data?.skipped ?? [];
        removeResolved([...applied, ...skipped]);
        setEditingId(null);
        if (applied.length > 0 || skipped.length > 0) {
          setMessage(
            skipped.length > 0
              ? `Confirmed ${applied.length}, ${skipped.length} already resolved.`
              : `Confirmed ${applied.length}.`,
          );
        }
      } else {
        setMessage('Something went wrong — please try again.');
      }
    } catch {
      setMessage('Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const acceptAll = () => submitBulkConfirm(items.map((i) => ({ gameId: i.gameId })));

  const acceptSelected = () =>
    submitBulkConfirm(items.filter((i) => selected.has(i.gameId)).map((i) => ({ gameId: i.gameId })));

  const acceptOne = (gameId: number) => submitBulkConfirm([{ gameId }]);

  const startEditing = (gameId: number, suggested: number) => {
    // Seed the draft with the suggested amount immediately so "Save" works even
    // if the user clicks it without first touching the (visibly pre-filled) input.
    setDrafts((prev) => (prev[gameId] !== undefined ? prev : { ...prev, [gameId]: String(suggested) }));
    setEditingId(gameId);
  };

  const adjustOne = (gameId: number) => {
    const raw = drafts[gameId];
    const value = raw !== undefined ? parseFloat(raw) : NaN;
    if (Number.isNaN(value) || value < 0) return;
    submitBulkConfirm([{ gameId, value }]);
  };

  const dismissOne = async (gameId: number) => {
    setBusy(true);
    setMessage(null);
    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissPriceSuggestion: true }),
      });
      if (resp.ok) {
        removeResolved([gameId]);
      } else {
        setMessage('Something went wrong — please try again.');
      }
    } catch {
      setMessage('Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = useMemo(() => selected.size, [selected]);

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-card p-6 text-sm text-muted-foreground">
        Nothing pending. Newly-purchased games get an estimate here once Hoard detects them as owned.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-3">
        <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            disabled={busy}
            aria-label="Select all"
          />
          Select all
        </label>
        <button
          onClick={acceptAll}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Accept All ({items.length})
        </button>
        <button
          onClick={acceptSelected}
          disabled={busy || selectedCount === 0}
          className="flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          Accept Selected {selectedCount > 0 ? `(${selectedCount})` : ''}
        </button>
        {message && <span className="text-xs text-muted-foreground ml-auto">{message}</span>}
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const isEditing = editingId === item.gameId;
          return (
            <li key={item.gameId} className="rounded-xl bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(item.gameId)}
                  onChange={() => toggleSelected(item.gameId)}
                  disabled={busy}
                  aria-label={`Select ${item.title}`}
                />
                <Link href={`/games/${item.gameId}`} className="font-medium text-sm hover:underline">
                  {item.title}
                </Link>
                <span className="flex items-center gap-1 text-xs text-amber-400/90 ml-1">
                  <Sparkles className="h-3 w-3" />
                  Est. ${item.pricePaidSuggested.toFixed(2)}
                </span>

                <div className="flex items-center gap-2 ml-auto">
                  {isEditing ? (
                    <>
                      <span className="text-sm text-muted-foreground">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100000"
                        aria-label={`Adjusted price paid for ${item.title}`}
                        value={drafts[item.gameId] ?? String(item.pricePaidSuggested)}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [item.gameId]: e.target.value }))}
                        className="w-24 px-2 py-1.5 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        onClick={() => adjustOne(item.gameId)}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        <Check className="h-3.5 w-3.5" /> Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        className="px-3 py-2 rounded-md bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => acceptOne(item.gameId)}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => startEditing(item.gameId, item.pricePaidSuggested)}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-2 rounded-md bg-secondary text-sm text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Adjust
                      </button>
                      <button
                        onClick={() => dismissOne(item.gameId)}
                        disabled={busy}
                        className="flex items-center gap-1 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[44px]"
                      >
                        <X className="h-3.5 w-3.5" /> Not now
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
