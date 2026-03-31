import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getEnrichedGames, getUnreleasedCount } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { WishlistGrid } from './WishlistGrid';
import { GameListFilters } from '@/components/filters/GameListFilters';
import { Pagination } from '@/components/ui/Pagination';
import { parseGameFiltersFromParams } from '@/lib/utils/filters';
import type { GameFilters } from '@/types';

export const dynamic = 'force-dynamic';

interface WishlistPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WishlistPage({ searchParams }: WishlistPageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;

  const filters: GameFilters = {
    view: 'wishlist',
    sortBy: 'dealScore',
    sortOrder: 'desc',
    requireCompleteData: params.showAll === 'true' ? false : true,
    hideUnreleased: params.showUnreleased === 'true' ? false : true,
    ...parseGameFiltersFromParams(params),
  };

  const page = typeof params.page === 'string' ? parseInt(params.page) : 1;
  const pageSize = 24;
  const { games, total, totalUnfiltered } = getEnrichedGames(filters, page, pageSize, session.user.id);

  const hiddenCount = totalUnfiltered !== undefined ? totalUnfiltered - total : 0;
  const unreleasedCount = getUnreleasedCount(session.user.id);

  const paginationParams: Record<string, string> = {};
  const showAllSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'page' && typeof value === 'string') {
      paginationParams[key] = value;
      if (key !== 'showAll' && key !== 'showUnreleased') showAllSearchParams.set(key, value);
    }
  }
  showAllSearchParams.set('showAll', 'true');
  showAllSearchParams.set('showUnreleased', 'true');
  const showAllHref = `/wishlist?${showAllSearchParams.toString()}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Wishlist</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0
            ? hiddenCount > 0
              ? <>
                  {total} of {totalUnfiltered} wishlisted games
                  {unreleasedCount > 0 && (
                    <> ({unreleasedCount} upcoming — <Link href="/releases" className="text-primary underline-offset-4 hover:underline">view releases</Link>)</>
                  )}
                  {hiddenCount > unreleasedCount && (
                    <> · <a href={showAllHref} className="text-primary underline-offset-4 hover:underline">{hiddenCount - unreleasedCount} hidden</a></>
                  )}
                </>
              : <>
                  {total} wishlisted games
                  {unreleasedCount > 0 && (
                    <> ({unreleasedCount} upcoming — <Link href="/releases" className="text-primary underline-offset-4 hover:underline">view releases</Link>)</>
                  )}
                </>
            : 'Your wishlisted games — see deals at a glance'}
        </p>
      </div>

      <GameListFilters currentFilters={filters} />

      {total === 0 && hiddenCount > 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.08] p-12 text-center space-y-3">
          <p className="text-muted-foreground">
            {hiddenCount} {hiddenCount === 1 ? 'game matches' : 'games match'}{filters.search ? ' your search' : ''} but {hiddenCount === 1 ? 'is' : 'are'} hidden by active filters (incomplete data or unreleased).
          </p>
          <a href={showAllHref} className="inline-block text-sm font-medium text-primary hover:underline">
            Show all matching games
          </a>
        </div>
      ) : (
        <WishlistGrid
          games={games}
          emptyMessage={
            filters.search
              ? 'No games found matching your search.'
              : 'No games found. Sync your Steam wishlist from Settings to get started.'
          }
        />
      )}

      <Pagination
        current={page}
        total={total}
        pageSize={pageSize}
        basePath="/wishlist"
        searchParams={paginationParams}
      />
    </div>
  );
}
