'use client';

import { useState } from 'react';
import { Clock, Users, Loader2 } from 'lucide-react';

interface PlaytimeSourceToggleProps {
  gameId: number;
  /** Current per-game preference. */
  source: 'hltb' | 'steam_reviews';
  /** HLTB main-story hours, if known (for the inline value hint). */
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
  hltbMain,
  steamPlaytimeMedian,
}: PlaytimeSourceToggleProps) {
  const [saving, setSaving] = useState<'hltb' | 'steam_reviews' | null>(null);
  const steamAvailable = steamPlaytimeMedian != null;

  const select = async (next: 'hltb' | 'steam_reviews') => {
    if (next === source || saving) return;
    if (next === 'steam_reviews' && !steamAvailable) return;
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
          disabled={saving !== null}
          className={`${baseBtn} ${source === 'hltb' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          title="Use HowLongToBeat main-story hours"
        >
          {saving === 'hltb' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
          HLTB{hltbMain ? ` (${hltbMain}h)` : ''}
        </button>
        <button
          onClick={() => select('steam_reviews')}
          disabled={saving !== null || !steamAvailable}
          className={`${baseBtn} border-l border-input ${source === 'steam_reviews' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          title={steamAvailable ? 'Use the median of Steam reviewers’ playtime' : 'No Steam review sample yet'}
        >
          {saving === 'steam_reviews' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          Reviews{steamAvailable ? ` (${steamPlaytimeMedian}h)` : ''}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Which playtime drives the $/hour value score for this game.
      </p>
    </div>
  );
}
