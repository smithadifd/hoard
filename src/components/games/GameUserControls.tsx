'use client';

import { useState, useRef } from 'react';
import { Eye, EyeOff, Star, Loader2, Bell, BellOff } from 'lucide-react';

interface GameUserControlsProps {
  gameId: number;
  interest: number;
  isWatchlisted: boolean;
  notes?: string;
  priceThreshold?: number;
  notifyOnAllTimeLow?: boolean;
  notifyOnThreshold?: boolean;
  currentPrice?: number;
  lastNotifiedAt?: string;
}

export function GameUserControls({
  gameId,
  interest: initialInterest,
  isWatchlisted: initialWatchlisted,
  notes: initialNotes,
  priceThreshold: initialThreshold,
  notifyOnAllTimeLow: initialAtl = true,
  notifyOnThreshold: initialThresholdNotify = true,
  currentPrice,
  lastNotifiedAt,
}: GameUserControlsProps) {
  const [interest, setInterest] = useState(initialInterest);
  const [isWatchlisted, setIsWatchlisted] = useState(initialWatchlisted);
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [notifyAtl, setNotifyAtl] = useState(initialAtl);
  const [notifyThreshold, setNotifyThreshold] = useState(initialThresholdNotify);
  const thresholdRef = useRef<HTMLInputElement>(null);

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

  const saveAlert = async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, ...updates }),
      });
    } catch (err) {
      console.error('Failed to save alert:', err);
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

  const handleThresholdBlur = () => {
    const value = thresholdRef.current?.value;
    const numValue = value ? parseFloat(value) : undefined;
    save({ priceThreshold: numValue ?? 0 });
  };

  const handleAtlToggle = () => {
    const newValue = !notifyAtl;
    setNotifyAtl(newValue);
    saveAlert({ notifyOnAllTimeLow: newValue });
  };

  const handleThresholdNotifyToggle = () => {
    const newValue = !notifyThreshold;
    setNotifyThreshold(newValue);
    saveAlert({ notifyOnThreshold: newValue });
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

      {/* Alert Controls (shown when watchlisted) */}
      {isWatchlisted && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Price Alerts</span>
          </div>

          {/* Price Threshold */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Notify when price drops below
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                ref={thresholdRef}
                type="number"
                step="0.01"
                min="0"
                defaultValue={initialThreshold ?? ''}
                onBlur={handleThresholdBlur}
                placeholder="e.g. 9.99"
                className="flex-1 px-2 py-1.5 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {currentPrice !== undefined && (
              <p className="text-xs text-muted-foreground">
                Current price: ${currentPrice.toFixed(2)}
              </p>
            )}
          </div>

          {/* Notification Toggles */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyAtl}
                onChange={handleAtlToggle}
                className="rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Alert at all-time low</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyThreshold}
                onChange={handleThresholdNotifyToggle}
                className="rounded border-input"
              />
              <span className="text-xs text-muted-foreground">Alert at price threshold</span>
            </label>
          </div>

          {/* Last Notified */}
          {lastNotifiedAt && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <BellOff className="h-3 w-3" />
              Last notified: {new Date(lastNotifiedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      )}

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
