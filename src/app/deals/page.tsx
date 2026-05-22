import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getEnrichedGames } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { InfiniteGameGrid } from '@/components/games/InfiniteGameGrid';
import { parseGameFiltersFromParams } from '@/lib/utils/filters';
import type { GameFilters } from '@/types';

export const dynamic = 'force-dynamic';

const RANGE_OPTIONS = [7, 14, 30, 90] as const;
const DEFAULT_DAYS = 30;

interface DealsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parseDays(raw: string | string[] | undefined): number {
  if (typeof raw !== 'string') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(365, Math.floor(n));
}

export default async function DealsPage({ searchParams }: DealsPageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;
  const daysBack = parseDays(params.days);

  const parsed = parseGameFiltersFromParams(params);

  const filters: GameFilters = {
    sortBy: 'atlHitDate',
    sortOrder: 'desc',
    ...parsed,
    // Pin view + window after user-controlled params so they can't be overridden.
    view: 'recent-deals',
    daysBack,
  };

  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, 1, pageSize, session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Recent Deals</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0
            ? `${total} game${total === 1 ? '' : 's'} hit an all-time low in the last ${daysBack} days`
            : `Games that hit an all-time low in the last ${daysBack} days will appear here`}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs font-label">
        <span className="text-muted-foreground/60 uppercase tracking-wide">Range</span>
        {RANGE_OPTIONS.map((n) => {
          const active = n === daysBack;
          return (
            <Link
              key={n}
              href={`/deals?days=${n}`}
              className={
                active
                  ? 'px-2.5 py-1 rounded-md bg-primary/15 text-primary border border-primary/30'
                  : 'px-2.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent'
              }
            >
              {n}d
            </Link>
          );
        })}
      </div>

      <InfiniteGameGrid
        initialGames={games}
        initialTotal={total}
        filters={filters}
        pageSize={pageSize}
        emptyMessage={`No games hit an all-time low in the last ${daysBack} days.`}
      />
    </div>
  );
}
