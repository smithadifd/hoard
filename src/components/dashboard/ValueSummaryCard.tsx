import { DollarSign, Clock, Gauge, Target } from 'lucide-react';
import type { ValueReceivedOverview } from '@/lib/db/queries';

/**
 * Spending-and-value rollup for the owned library: what you've put in, what you've
 * played, your blended cost-per-hour, and how often you've reached expected value.
 * Server component — pure presentation of {@link getValueReceivedOverview} stats.
 */
export function ValueSummaryCard({ stats }: { stats: ValueReceivedOverview['stats'] }) {
  const { totalSpent, pricedGames, totalHours, blendedDollarsPerHour, expectedValueHits, moneyLensGames } = stats;

  const hitRate = moneyLensGames > 0 ? Math.round((expectedValueHits / moneyLensGames) * 100) : null;

  const cells: Array<{ icon: React.ReactNode; label: string; value: string; sub: string }> = [
    {
      icon: <DollarSign className="h-4 w-4" />,
      label: 'Total Spent',
      value: pricedGames > 0 ? `$${totalSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—',
      sub: pricedGames > 0 ? `across ${pricedGames} priced game${pricedGames === 1 ? '' : 's'}` : 'add prices to track',
    },
    {
      icon: <Clock className="h-4 w-4" />,
      label: 'Hours Played',
      value: totalHours > 0 ? `${totalHours.toLocaleString()}h` : '—',
      sub: 'across your library',
    },
    {
      icon: <Gauge className="h-4 w-4" />,
      label: 'Blended $/hr',
      value: blendedDollarsPerHour != null ? `$${blendedDollarsPerHour.toFixed(2)}` : '—',
      sub: blendedDollarsPerHour != null ? 'realized cost per hour' : 'needs price + playtime',
    },
    {
      icon: <Target className="h-4 w-4" />,
      label: 'Expected Value',
      value: hitRate != null ? `${hitRate}%` : '—',
      sub: hitRate != null ? `${expectedValueHits} of ${moneyLensGames} games` : 'needs price + playtime',
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
