import { redirect } from 'next/navigation';
import { getEnrichedGames, getAllGenres } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { GameGrid } from '@/components/games/GameGrid';
import { BacklogFilters } from '@/components/backlog/BacklogFilters';
import { Pagination } from '@/components/ui/Pagination';
import type { GameFilters } from '@/types';

interface BacklogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BacklogPage({ searchParams }: BacklogPageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;

  const filters: GameFilters = {
    view: 'library',
    search: typeof params.search === 'string' ? params.search : undefined,
    sortBy: (typeof params.sortBy === 'string' ? params.sortBy : 'title') as GameFilters['sortBy'],
    sortOrder: (typeof params.sortOrder === 'string' ? params.sortOrder : 'asc') as GameFilters['sortOrder'],
    maxHours: typeof params.maxHours === 'string' ? Number(params.maxHours) : undefined,
    minHours: typeof params.minHours === 'string' ? Number(params.minHours) : undefined,
    coop: typeof params.coop === 'string' ? params.coop === 'true' : undefined,
    onSale: typeof params.onSale === 'string' ? params.onSale === 'true' : undefined,
    playtimeStatus: typeof params.playtime === 'string'
      ? (params.playtime as GameFilters['playtimeStatus'])
      : 'unplayed', // Default to unplayed
    genres: typeof params.genres === 'string' && params.genres
      ? params.genres.split(',')
      : undefined,
    minReview: typeof params.minReview === 'string' ? Number(params.minReview) : undefined,
  };

  const page = typeof params.page === 'string' ? parseInt(params.page) : 1;
  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, page, pageSize, session.user.id);
  const availableGenres = getAllGenres();

  const paginationParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'page' && typeof value === 'string') {
      paginationParams[key] = value;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Backlog</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0
            ? `${total} games match your filters`
            : 'Find your next game to play'}
        </p>
      </div>

      <BacklogFilters
        currentFilters={filters}
        games={games}
        availableGenres={availableGenres}
      />

      <GameGrid
        games={games}
        emptyMessage="No games match your filters. Try adjusting the filters or sync your library from Settings."
      />

      <Pagination
        current={page}
        total={total}
        pageSize={pageSize}
        basePath="/backlog"
        searchParams={paginationParams}
      />
    </div>
  );
}
