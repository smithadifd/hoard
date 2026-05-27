'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, Loader2 } from 'lucide-react';
import type { DrainProgress, DrainStage } from '@/lib/onboarding/types';

const POLL_MS = 2_000;

const STAGE_LABELS: Record<DrainStage, string> = {
  'price-history': 'Price history',
  metadata: 'Metadata',
  hltb: 'HowLongToBeat',
  reviews: 'Reviews',
};

interface DrainStatusCardProps {
  initial: DrainProgress;
}

/**
 * Visible while an enrichment drain is in flight. Polls the drain endpoint
 * every 2s and hides itself once the drain completes or pauses (paused state
 * surfaces via the global `DrainPausedBanner` instead).
 */
export function DrainStatusCard({ initial }: DrainStatusCardProps) {
  const [progress, setProgress] = useState<DrainProgress>(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/onboarding/drain');
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { data: DrainProgress };
        if (!cancelled) setProgress(body.data);
      } catch {
        // Non-fatal — leave the last-known snapshot rendered.
      }
    };
    void tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Hide once finished or paused — the paused state has a dedicated banner.
  if (progress.completedAt || progress.paused || !progress.running) return null;

  const stage = progress.stage;
  const stageProgress = stage ? progress.stages[stage] : null;
  const percent =
    stageProgress && stageProgress.total > 0
      ? Math.round((stageProgress.processed / stageProgress.total) * 100)
      : 0;

  return (
    <div className="rounded-xl bg-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
            Enrichment in progress
          </h2>
        </div>
        <Link
          href="/onboarding"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View full progress <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">
          {stage ? STAGE_LABELS[stage] : 'Starting…'}
        </span>
        {stageProgress && stageProgress.total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {stageProgress.processed.toLocaleString()} /{' '}
            {stageProgress.total.toLocaleString()}
          </span>
        )}
      </div>

      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground leading-snug">
        You can keep using Hoard — we&apos;ll keep working in the background and ping you in the
        notifications panel when it finishes.
      </p>
    </div>
  );
}
