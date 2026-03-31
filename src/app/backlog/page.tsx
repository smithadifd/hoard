import { redirect } from 'next/navigation';
import { getEnrichedGames, getAllGenres, countGames } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { GameGrid } from '@/components/games/GameGrid';
import { BacklogFilters } from '@/components/backlog/BacklogFilters';
import { Pagination } from '@/components/ui/Pagination';
import { BACKLOG_PRESETS } from '@/lib/backlog/presets';
import { parseGameFiltersFromParams } from '@/lib/utils/filters';
import type { GameFilters } from '@/types';

export const dynamic = 'force-dynamic';

interface BacklogPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BacklogPage({ searchParams }: BacklogPageProps) {
  const session = await getSession();
  if (!session) redirect('/login');

  const params = await searchParams;

  const filters: GameFilters = {
    view: 'library',
    strictFilters: true, // Backlog always uses strict filters — no NULL pass-through
    sortBy: 'title',
    sortOrder: 'asc',
    playtimeStatus: 'backlog', // Default to smart backlog (unplayed + barely started)
    ...parseGameFiltersFromParams(params),
  };

  // Allow toggling strict filters off via URL param
  if (params.showMissing === 'true') {
    filters.strictFilters = false;
  }

  const page = typeof params.page === 'string' ? parseInt(params.page) : 1;
  const pageSize = 24;
  const { games, total } = getEnrichedGames(filters, page, pageSize, session.user.id);
  const availableGenres = getAllGenres();

  // Count how many games are hidden by strict filters (missing HLTB/review data)
  const totalWithMissing = filters.strictFilters
    ? countGames({ ...filters, strictFilters: false }, session.user.id)
    : total;
  const hiddenByStrictCount = totalWithMissing - total;

  // Compute match counts for each preset (efficient count-only queries)
  const presetCounts: Record<string, number> = {};
  for (const preset of BACKLOG_PRESETS) {
    presetCounts[preset.id] = countGames(
      { view: 'library', ...preset.filters },
      session.user.id,
    );
  }

  // Detect which preset is active for empty state messaging
  const activePreset = BACKLOG_PRESETS.find((p) => {
    for (const [key, value] of Object.entries(p.filters)) {
      const k = key as keyof GameFilters;
      if (filters[k] !== value) return false;
    }
    return true;
  });

  const paginationParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'page' && typeof value === 'string') {
      paginationParams[key] = value;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Backlog</h1>
        <p className="text-muted-foreground mt-1">
          {total > 0
            ? hiddenByStrictCount > 0
              ? `${total} games match your filters (${hiddenByStrictCount} more with incomplete data)`
              : `${total} games match your filters`
            : 'Find your next game to play'}
        </p>
      </div>

      <BacklogFilters
        currentFilters={filters}
        games={games}
        availableGenres={availableGenres}
        presetCounts={presetCounts}
        hiddenByStrictCount={hiddenByStrictCount}
      />

      {total === 0 && activePreset ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No games match &ldquo;{activePreset.label}&rdquo;</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {activePreset.description}. Try syncing your library metadata or adjusting filters.
          </p>
        </div>
      ) : (
        <GameGrid
          games={games}
          emptyMessage="No games match your filters. Try adjusting the filters or sync your library from Settings."
        />
      )}

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
