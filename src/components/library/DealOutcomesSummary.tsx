import { Target, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import type { DealOutcomeBreakdownEntry } from '@/lib/scoring/dealOutcomes';

/**
 * Headline stats for the Deal Outcomes report — the overall hit rate plus the
 * hit/miss/pending/unknown counts that make it up. Server component — pure
 * presentation of a {@link DealOutcomeBreakdownEntry} (the `overall` field of
 * `computeDealOutcomesReport`'s output).
 */
export function DealOutcomesSummary({ overall }: { overall: DealOutcomeBreakdownEntry }) {
  const { hits, misses, pending, unknown, graded, hitRate } = overall;

  const cells: Array<{ icon: React.ReactNode; label: string; value: string; sub: string }> = [
    {
      icon: <Target className="h-4 w-4" />,
      label: 'Hit Rate',
      value: hitRate != null ? `${hitRate}%` : '—',
      sub: graded > 0 ? `${hits} of ${graded} graded deals` : 'no graded deals yet',
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" />,
      label: 'Hits',
      value: `${hits}`,
      sub: 'played through what the price implied',
    },
    {
      icon: <XCircle className="h-4 w-4" />,
      label: 'Misses',
      value: `${misses}`,
      sub: 'played less than expected',
    },
    {
      icon: <HelpCircle className="h-4 w-4" />,
      label: 'Too Early / Unknown',
      value: `${pending + unknown}`,
      sub: pending > 0 && unknown > 0 ? `${pending} unplayed, ${unknown} no estimate` : pending > 0 ? 'not played yet' : unknown > 0 ? 'no hours estimate' : 'none',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg bg-surface-high/40 p-3.5">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-primary">{c.icon}</span>
            <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {c.label}
            </span>
          </div>
          <div className="text-xl font-headline font-extrabold">{c.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
