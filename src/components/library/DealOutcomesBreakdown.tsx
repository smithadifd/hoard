import type { DealOutcomeBreakdownEntry } from '@/lib/scoring/dealOutcomes';

/**
 * One dimension of the Deal Outcomes hit-rate breakdown (store, genre, discount
 * depth, or deal-score band) — a bar per bucket sized to its hit rate, with the
 * graded fraction and the not-yet-gradable count called out honestly rather than
 * folded into the rate. Server component — pure presentation.
 */
export function DealOutcomesBreakdown({ title, entries }: { title: string; entries: DealOutcomeBreakdownEntry[] }) {
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">No priced games to break down yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {entries.map((e) => (
          <li key={e.key}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="truncate">{e.key}</span>
              <span className="font-label font-semibold tabular-nums text-muted-foreground shrink-0 ml-2">
                {e.hitRate != null ? `${e.hitRate}% (${e.hits}/${e.graded})` : 'no data yet'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              {e.hitRate != null && (
                <div
                  className={`h-full rounded-full ${e.hitRate >= 60 ? 'bg-deal-good' : e.hitRate >= 35 ? 'bg-deal-okay' : 'bg-deal-poor'}`}
                  style={{ width: `${e.hitRate}%` }}
                />
              )}
            </div>
            {(e.pending > 0 || e.unknown > 0) && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                +{e.pending + e.unknown} not yet gradable
                {e.pending > 0 && e.unknown > 0
                  ? ` (${e.pending} unplayed, ${e.unknown} no estimate)`
                  : e.pending > 0
                    ? ' (unplayed)'
                    : ' (no hours estimate)'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
