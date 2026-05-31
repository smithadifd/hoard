'use client';

import { useState } from 'react';
import { Star, Loader2, Check } from 'lucide-react';

/**
 * EnjoymentRatingEditor - Post-play "was it worth it?" rating for an owned game.
 *
 * Optional; once set, the rating LEADS the Value Received verdict (the warm
 * headline) and demotes $/hr to supporting context. Clearing reverts to the
 * efficiency/time lens. Rides PATCH /api/games/:id (already demo-blocked).
 */
interface EnjoymentRatingEditorProps {
  gameId: number;
  enjoymentRating?: number;
}

const STARS = [1, 2, 3, 4, 5];

export function EnjoymentRatingEditor({ gameId, enjoymentRating }: EnjoymentRatingEditorProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const current = enjoymentRating ?? 0;
  const shown = hover ?? current;

  const save = async (value: number | null) => {
    setSaving(true);
    setSaved(false);
    try {
      const resp = await fetch(`/api/games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enjoymentRating: value }),
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

  return (
    <div className="rounded-xl bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Was it worth it?</span>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {saved && <Check className="h-3.5 w-3.5 text-deal-good" />}
          {current > 0 && !saving && (
            <button
              onClick={() => save(null)}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              title="Clear your rating"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {STARS.map((n) => (
          <button
            key={n}
            onClick={() => save(n)}
            onMouseEnter={() => setHover(n)}
            disabled={saving}
            className="p-1 -m-1 disabled:opacity-50"
            title={`${n} star${n === 1 ? '' : 's'}`}
            aria-label={`Rate ${n} of 5`}
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                n <= shown ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground/40'
              }`}
            />
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {current > 0
          ? 'Your rating leads the verdict — $/hr becomes supporting context.'
          : 'Optional — your honest take leads the value verdict, regardless of hours.'}
      </p>
    </div>
  );
}
