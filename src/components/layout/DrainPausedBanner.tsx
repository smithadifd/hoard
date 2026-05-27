'use client';

import { useEffect, useState } from 'react';
import { PauseCircle } from 'lucide-react';
import type { DrainProgress } from '@/lib/onboarding/types';

const POLL_MS = 60_000;

interface PausedSnapshot {
  pausedUntil: string | null;
  reason: 'rate-limit' | 'manual';
}

/**
 * Top banner that surfaces a paused drain so the user knows enrichment isn't
 * stalled because of a bug. Manual pauses are noisy enough on their own; we
 * only surface `rate-limit` pauses here to avoid yelling at users who hit
 * Cancel intentionally.
 */
export function DrainPausedBanner() {
  const [snapshot, setSnapshot] = useState<PausedSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await fetch('/api/onboarding/drain');
        if (!res.ok) return;
        const body = (await res.json()) as { data: DrainProgress };
        if (cancelled) return;
        if (body.data.paused && body.data.pauseReason === 'rate-limit') {
          setSnapshot({ pausedUntil: body.data.pausedUntil, reason: 'rate-limit' });
        } else {
          setSnapshot(null);
        }
      } catch {
        // Non-fatal; banner stays hidden until next tick.
      }
    };

    void refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!snapshot) return null;

  const until = snapshot.pausedUntil ? new Date(snapshot.pausedUntil) : null;
  const untilLabel = until
    ? until.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-amber-500 bg-amber-500/10 border-b border-amber-500/20">
      <PauseCircle className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        Enrichment paused — an upstream API rate-limited us
        {untilLabel ? `, resuming ${untilLabel}` : ''}. Cron will pick up the queue on the next
        scheduled run.
      </span>
    </div>
  );
}
