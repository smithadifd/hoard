import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles, Tag, TrendingDown } from 'lucide-react';
import { getEnrichedGames } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { GameGrid } from '@/components/games/GameGrid';
import type { GameFilters } from '@/types';

export const dynamic = 'force-dynamic';

const RANGE_OPTIONS = [7, 14, 30, 90] as const;
const DEFAULT_DAYS = 14;
const SECTION_SIZE = 24;

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

  // Unreleased games surface noisy preorder/sentinel prices from ITAD (e.g. $999
  // placeholders). Exclude them from every section — the deal data isn't actionable
  // until the game releases. `hideUnreleased` keeps games where is_released IS NULL
  // (status unknown), so newly-tracked games still appear.

  // Section 1: New ATLs in window — first-ever hit at this price
  const newAtls = getEnrichedGames(
    { view: 'new-atls', daysBack, sortBy: 'atlHitDate', sortOrder: 'desc', hideUnreleased: true } as GameFilters,
    1,
    SECTION_SIZE,
    session.user.id,
  );

  const newAtlIds = newAtls.games.map((g) => g.id);

  // Section 2: Deepest discounts (wishlisted, not owned)
  const deepest = getEnrichedGames(
    {
      view: 'deepest-discounts',
      sortBy: 'discount',
      sortOrder: 'desc',
      excludeGameIds: newAtlIds,
      hideUnreleased: true,
    } as GameFilters,
    1,
    SECTION_SIZE,
    session.user.id,
  );

  const heatingExclude = [...newAtlIds, ...deepest.games.map((g) => g.id)];

  // Section 3: Heating up — current price ≥15% below 90d avg
  const heatingUp = getEnrichedGames(
    {
      view: 'heating-up',
      sortBy: 'belowAvgPercent',
      sortOrder: 'desc',
      excludeGameIds: heatingExclude,
      hideUnreleased: true,
    } as GameFilters,
    1,
    SECTION_SIZE,
    session.user.id,
  );

  const totalShown = newAtls.games.length + deepest.games.length + heatingUp.games.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Recent Deals</h1>
        <p className="text-muted-foreground mt-1">
          {totalShown > 0
            ? `Notable price movement across your wishlist and library`
            : `No notable deals in the last ${daysBack} days`}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs font-label">
        <span className="text-muted-foreground/60 uppercase tracking-wide">Window</span>
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

      <DealSection
        icon={<Sparkles className="h-4 w-4 text-teal" />}
        title="New all-time lows"
        subtitle={`First time at this price — last ${daysBack} days`}
        count={newAtls.total}
        emptyMessage={`No games hit a new all-time low in the last ${daysBack} days.`}
        games={newAtls.games}
      />

      <DealSection
        icon={<Tag className="h-4 w-4 text-primary" />}
        title="Deepest discounts"
        subtitle="Wishlisted games at their highest current % off"
        count={deepest.total}
        emptyMessage="Nothing on a notable discount right now."
        games={deepest.games}
      />

      <DealSection
        icon={<TrendingDown className="h-4 w-4 text-teal" />}
        title="Heating up"
        subtitle="Now 15%+ below the 90-day average"
        count={heatingUp.total}
        emptyMessage="No wishlist games are meaningfully below their recent baseline."
        games={heatingUp.games}
      />
    </div>
  );
}

function DealSection({
  icon,
  title,
  subtitle,
  count,
  emptyMessage,
  games,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  emptyMessage: string;
  games: import('@/types').EnrichedGame[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-base font-headline font-bold tracking-tight">{title}</h2>
          {count > 0 && (
            <span className="text-xs text-muted-foreground/70 font-label">
              ({count.toLocaleString()})
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <GameGrid games={games} emptyMessage={emptyMessage} />
    </section>
  );
}
