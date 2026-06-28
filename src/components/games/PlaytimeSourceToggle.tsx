'use client';

import { useState } from 'react';
import { Clock, Users, Loader2 } from 'lucide-react';

interface PlaytimeSourceToggleProps {
  gameId: number;
  /** Stored per-game preference. */
  source: 'hltb' | 'steam_reviews';
  /**
   * The source ACTUALLY driving $/hour right now — may differ from `source` when
   * an HLTB-less game falls back to the review median. Drives the highlight so the
   * control reads honestly. Null when no playtime data is available.
   */
  effectiveSource?: 'hltb' | 'steam_reviews' | null;
  /** HLTB main-story hours, if known. The HLTB option is disabled when absent. */
  hltbMain?: number;
  /** Steam-review median hours, if fetched. The Steam option is disabled when absent. */
  steamPlaytimeMedian?: number;
}

/**
 * Segmented control letting the user pick which playtime basis feeds $/hour
 * scoring for a game: HLTB main-story vs the median of Steam reviewers' playtime.
 * Mirrors the HltbEditor's PATCH-then-reload pattern so the recomputed deal score
 * is reflected everywhere on the next render.
 */
export function PlaytimeSourceToggle({
  gameId,
  source,
  effectiveSource,
  hltbMain,
  steamPlaytimeMedian,
}: PlaytimeSourceToggleProps) {
  const [saving, setSaving] = useState<'hltb' | 'steam_reviews' | null>(null);
  const hltbAvailable = hltbMain != null;
  const steamAvailable = steamPlaytimeMedian != null;
  // Highlight what's actually driving $/hour; fall back to the stored preference.
  const active = effectiveSource ?? source;
  // True when $/hour is auto-using reviews because there's no HLTB data (stored
  // preference is still HLTB, but reviews are filling the gap).
  const autoFallback = source === 'hltb' && active === 'steam_reviews';

  const select = async (next: 'hltb' | 'steam_reviews') => {
    if (next === source || saving) return;
    if (next === 'steam_reviews' && !steamAvailable) return;
    if (next === 'hltb' && !hltbAvailable) return;
    setSaving(next);
    try {
      await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playtimeSource: next }),
      });
      window.location.reload();
    } catch {
      setSaving(null);
    }
  };

  const baseBtn =
    'flex-1 flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium transition-colors min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="rounded-xl bg-card p-4 space-y-2">
      <span className="text-sm font-medium">$/hour basis</span>
      <div className="flex rounded-lg border border-input overflow-hidden">
        <button
          onClick={() => select('hltb')}
          disabled={saving !== null || !hltbAvailable}
          className={`${baseBtn} ${active === 'hltb' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          title={hltbAvailable ? 'Use HowLongToBeat main-story hours' : 'No HLTB data for this game'}
        >
          {saving === 'hltb' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
          HLTB{hltbAvailable ? ` (${hltbMain}h)` : ''}
        </button>
        <button
          onClick={() => select('steam_reviews')}
          disabled={saving !== null || !steamAvailable}
          className={`${baseBtn} border-l border-input ${active === 'steam_reviews' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          title={steamAvailable ? 'Use the median of Steam reviewers’ playtime' : 'No Steam review sample yet'}
        >
          {saving === 'steam_reviews' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          Reviews{steamAvailable ? ` (${steamPlaytimeMedian}h)` : ''}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {autoFallback
          ? 'No HLTB data — $/hour is using the Steam-review median. It switches to HLTB automatically if that data lands.'
          : 'Which playtime drives the $/hour value score for this game.'}
      </p>
    </div>
  );
}
