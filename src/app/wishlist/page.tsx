import { getEnrichedGames } from '@/lib/db/queries';
import { GameGrid } from '@/components/games/GameGrid';
import { GameListFilters } from '@/components/filters/GameListFilters';
import { Pagination } from '@/components/ui/Pagination';
import type { GameFilters } from '@/types';

interface WishlistPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WishlistPage({ searchParams }: WishlistPageProps) {
  const params = await searchParams;

  const filters: GameFilters = {
    view: 'wishlist',
    search: typeof params.search === 'string' ? params.search : undefined,
    sortBy: (typeof params.sortBy === 'string' ? params.sortBy : 'title') as GameFilters['sortBy'],
    sortOrder: (typeof params.sortOrder === 'string' ? params.sortOrder : 'asc') as GameFilters['sortOrder'],
    maxHours: typeof params.maxHours === 'string' ? Number(params.maxHours) : undefined,
    coop: typeof params.coop === 'string' ? params.coop === 'true' : undefined,
  };

  const page = typeof params.page === 'string' ? parseInt(params.page) : 1;
  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, page, pageSize);

  const paginationParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'page' && typeof value === 'string') {
      paginationParams[key] = value;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0 ? `${total} wishlisted games` : 'Your wishlisted games — see deals at a glance'}
        </p>
      </div>

      <GameListFilters currentFilters={filters} />

      <GameGrid
        games={games}
        emptyMessage="No games found. Sync your Steam wishlist from Settings to get started."
      />

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
