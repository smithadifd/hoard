'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star, X } from 'lucide-react';
import type { TriageNudgeStatus } from '@/lib/onboarding/types';

interface TriageNudgeCardProps {
  initial: TriageNudgeStatus;
}

/**
 * Dashboard nudge that pushes new users toward triage. Hidden once dismissed
 * or once the underlying counts no longer meet the threshold. Dismissal is
 * persisted for 7 days via `triagePromptDismissedAt` on the onboarding state.
 */
export function TriageNudgeCard({ initial }: TriageNudgeCardProps) {
  const [hidden, setHidden] = useState(!initial.shouldShow);

  if (hidden) return null;

  const handleDismiss = async () => {
    setHidden(true);
    try {
      await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triagePromptDismissedAt: new Date().toISOString() }),
      });
    } catch {
      // Non-fatal — the card will reappear on next page load.
      setHidden(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-5 relative">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Star className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-headline font-bold mb-1">
              Rate your library to unlock the backlog recommender
            </h2>
            <p className="text-sm text-muted-foreground leading-snug">
              You have <strong>{initial.untriagedCount.toLocaleString()}</strong> unrated{' '}
              {initial.untriagedCount === 1 ? 'game' : 'games'}. Rate a handful and the
              recommender picks games that match your taste, not just your shelf.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/triage"
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                Start triaging
              </Link>
              <Link
                href="/library"
                className="inline-flex items-center px-3 py-1.5 rounded-md bg-accent text-foreground text-xs font-medium hover:bg-accent/80 transition-colors"
              >
                Browse library
              </Link>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Dismiss triage nudge"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
