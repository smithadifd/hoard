import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wallet, DollarSign, Scale } from 'lucide-react';
import { getEnrichedGames, getValueReceivedOverview } from '@/lib/db/queries';
import type { ValueReceivedOverview } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { InfiniteGameGrid } from '@/components/games/InfiniteGameGrid';
import { GameListFilters } from '@/components/filters/GameListFilters';
import ValueReceivedChart from '@/components/dashboard/ValueReceivedChart';
import { ValueSummaryCard } from '@/components/dashboard/ValueSummaryCard';
import { parseGameFiltersFromParams } from '@/lib/utils/filters';
import type { GameFilters } from '@/types';

export const dynamic = 'force-dynamic';

interface LibraryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;

  const filters: GameFilters = {
    view: 'library',
    // Lead with realized value — the library's answer to the wishlist's deal score.
    // Any explicit ?sortBy in the URL (set by the filter controls) overrides this default.
    sortBy: 'valueReceived',
    sortOrder: 'desc',
    ...parseGameFiltersFromParams(params),
  };

  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, 1, pageSize, session.user.id);

  let valueOverview: ValueReceivedOverview | null = null;
  try {
    valueOverview = getValueReceivedOverview(session.user.id);
  } catch {
    // DB not ready yet — fall back to the grid without the value rollup.
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Library</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0 ? `${total} owned games` : 'Your owned games — filter, sort, and find your next play'}
        </p>
      </div>

      {/* Lead with Value Received — the same rollup the dashboard shows, so the library
          headlines "did I get my money's worth?" instead of an A–Z wall of titles. */}
      {total > 0 && valueOverview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ValueCard icon={<Wallet className="h-4 w-4" />} title="Value Received">
            <ValueReceivedChart data={valueOverview.distribution} />
          </ValueCard>
          <ValueCard icon={<DollarSign className="h-4 w-4" />} title="Spending & Value">
            <ValueSummaryCard stats={valueOverview.stats} />
          </ValueCard>
        </div>
      )}

      {total > 0 && (
        <Link
          href="/library/deal-outcomes"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <Scale className="h-4 w-4" />
          See how your deals played out (expected vs realized value) →
        </Link>
      )}

      <GameListFilters currentFilters={filters} showValueFilters />

      <InfiniteGameGrid
        initialGames={games}
        initialTotal={total}
        filters={filters}
        pageSize={pageSize}
        from="library"
        emptyMessage="No games found. Sync your Steam library from Settings to get started."
      />
    </div>
  );
}

/** Card chrome matching the dashboard's Value Received cards (rounded-xl bg-card, icon + label). */
function ValueCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-primary">{icon}</span>
        <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}
