import Link from 'next/link';
import type { DealOutcome, DealOutcomeVerdict } from '@/lib/scoring/dealOutcomes';

const VERDICT_META: Record<DealOutcomeVerdict, { label: string; className: string }> = {
  hit: { label: 'Hit', className: 'bg-deal-good text-white' },
  miss: { label: 'Miss', className: 'bg-deal-poor text-white' },
  pending: { label: 'Too early', className: 'bg-secondary text-muted-foreground' },
  unknown: { label: 'No estimate', className: 'bg-secondary text-muted-foreground' },
};

const COMPLETION_LABEL: Record<string, string> = {
  unplayed: 'Unplayed',
  playing: 'Playing',
  beaten: 'Beaten',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

function formatDollarsPerHour(v: number | null): string {
  return v != null ? `$${v.toFixed(2)}/hr` : '—';
}

/**
 * Per-game deal-outcome rows: what was expected at purchase (predicted $/hr)
 * vs what was realized (actual $/hr, enjoyment, completion), and the verdict
 * that follows from comparing the two. Server component — pure presentation
 * of {@link DealOutcome}[] from `computeDealOutcomesReport`.
 */
export function DealOutcomesTable({ games }: { games: DealOutcome[] }) {
  if (games.length === 0) {
    return <p className="text-sm text-muted-foreground">No priced, owned games to grade yet.</p>;
  }

  const sorted = [...games].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-label font-semibold uppercase tracking-wider text-muted-foreground border-b border-white/[0.06]">
            <th className="py-2 pr-3">Game</th>
            <th className="py-2 pr-3">Store</th>
            <th className="py-2 pr-3">Genres</th>
            <th className="py-2 pr-3 text-right">Discount</th>
            <th className="py-2 pr-3 text-right">Deal Score</th>
            <th className="py-2 pr-3 text-right">Predicted $/hr</th>
            <th className="py-2 pr-3 text-right">Realized $/hr</th>
            <th className="py-2 pr-3">Enjoyment</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((g) => {
            const verdict = VERDICT_META[g.verdict];
            return (
              <tr key={g.gameId} className="border-b border-white/[0.04] last:border-0">
                <td className="py-2 pr-3 min-w-[140px]">
                  <Link href={`/games/${g.gameId}`} className="hover:text-primary transition-colors">
                    {g.title}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-muted-foreground capitalize">{g.store ?? '—'}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {g.genres.length > 0 ? g.genres.join(', ') : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {g.discountPercent != null ? `-${g.discountPercent}%` : '—'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{g.dealScoreBand ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatDollarsPerHour(g.predictedDollarsPerHour)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatDollarsPerHour(g.realizedDollarsPerHour)}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {g.enjoymentRating != null ? `${g.enjoymentRating}/5` : '—'}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {COMPLETION_LABEL[g.completionStatus] ?? g.completionStatus}
                </td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-label font-bold ${verdict.className}`}>
                    {verdict.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
