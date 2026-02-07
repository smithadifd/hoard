/**
 * Game Detail Page - Comprehensive view of a single game.
 *
 * Shows:
 * - Game info (title, description, images)
 * - Steam reviews
 * - Current prices across stores (ITAD)
 * - Price history / historical low
 * - HLTB play time estimates
 * - Deal score breakdown
 * - Links to loaded.com, SteamDB, etc.
 */
export default function GameDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <p className="text-lg">Game detail page for ID: {params.id}</p>
        <p className="text-sm mt-1">Coming in Phase 1</p>
      </div>
    </div>
  );
}
