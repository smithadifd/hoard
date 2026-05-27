'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle, ListChecks, X } from 'lucide-react';
import type { ChecklistResult } from '@/lib/onboarding/types';

interface OnboardingChecklistProps {
  initial: ChecklistResult;
}

/**
 * Soft dashboard widget that nudges new users to finish setup. Renders nothing
 * once `allDone` is true or the user explicitly dismisses it. Persistence runs
 * through `PATCH /api/onboarding/state { checklistDismissed: true }`.
 */
export function OnboardingChecklist({ initial }: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(initial.dismissed);

  if (initial.allDone || dismissed) return null;

  const completed = initial.items.filter((i) => i.done).length;
  const total = initial.items.length;
  const percent = Math.round((completed / total) * 100);

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistDismissed: true }),
      });
    } catch {
      // Non-fatal — the widget will reappear on next page load.
      setDismissed(false);
    }
  };

  return (
    <div className="rounded-xl bg-card p-5 relative">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
            Finish setting up
          </h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Dismiss checklist"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm">
            <strong>{completed}</strong> of {total} complete
          </span>
          <span className="text-xs text-muted-foreground">{percent}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1.5">
        {initial.items.map((item) => {
          const Icon = item.done ? CheckCircle2 : Circle;
          const iconColor = item.done ? 'text-emerald-500' : 'text-muted-foreground';
          const labelColor = item.done ? 'text-muted-foreground line-through' : 'text-foreground';

          const inner = (
            <>
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${labelColor}`}>{item.label}</span>
                {!item.done && (
                  <span className="block text-xs text-muted-foreground leading-snug">
                    {item.description}
                  </span>
                )}
              </div>
              {!item.done && item.href && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
              )}
            </>
          );

          if (!item.done && item.href) {
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/40 transition-colors"
                >
                  {inner}
                </Link>
              </li>
            );
          }

          return (
            <li key={item.key} className="flex items-start gap-2 px-2 py-1.5 -mx-2">
              {inner}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
