/**
 * Library Page - Browse owned games with filters and sorting.
 *
 * Phase 1: Display games from Steam library with playtime.
 * Phase 3: Add HLTB duration, value scoring.
 * Phase 4: Add backlog recommendations, random pick.
 */
export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <p className="text-muted-foreground mt-1">
          Your owned games — filter, sort, and find your next play
        </p>
      </div>

      {/* TODO Phase 1: GameFilters component */}
      {/* TODO Phase 1: GameGrid component showing owned games */}

      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p className="text-lg">Library view coming in Phase 1</p>
        <p className="text-sm mt-1">Sync your Steam library from Settings to get started</p>
      </div>
    </div>
  );
}
