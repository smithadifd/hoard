/**
 * Backlog Page - Find your next game to play.
 *
 * Features:
 * - Filter by duration (HLTB), genre, co-op, etc.
 * - "Pick for me" random selection with filters
 * - "Date night" mode: co-op + short duration
 *
 * Phase 4: Full implementation.
 */
export default function BacklogPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Backlog</h1>
        <p className="text-muted-foreground mt-1">
          Find your next game — filter by time, genre, and more
        </p>
      </div>

      {/* TODO Phase 4: Duration filters (short/medium/long) */}
      {/* TODO Phase 4: Co-op filter for playing with others */}
      {/* TODO Phase 4: "Pick for me" random button with active filters */}
      {/* TODO Phase 4: "Date night" preset (co-op + under 10hrs) */}

      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p className="text-lg">Backlog recommender coming in Phase 4</p>
        <p className="text-sm mt-1">Sync your library and HLTB data first</p>
      </div>
    </div>
  );
}
