import { redirect } from 'next/navigation';
import { getEnrichedGames } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { InfiniteGameGrid } from '@/components/games/InfiniteGameGrid';
import { GameListFilters } from '@/components/filters/GameListFilters';
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
    sortBy: 'title',
    sortOrder: 'asc',
    ...parseGameFiltersFromParams(params),
  };

  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, 1, pageSize, session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Library</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0 ? `${total} owned games` : 'Your owned games — filter, sort, and find your next play'}
        </p>
      </div>

      <GameListFilters currentFilters={filters} />

      <InfiniteGameGrid
        initialGames={games}
        initialTotal={total}
        filters={filters}
        pageSize={pageSize}
        emptyMessage="No games found. Sync your Steam library from Settings to get started."
      />
    </div>
  );
}
