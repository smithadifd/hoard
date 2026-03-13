'use client';

import { useState } from 'react';
import { GameCard } from '@/components/games/GameCard';
import type { EnrichedGame } from '@/types';
import type { ReleaseBucket } from '@/lib/utils/releaseDate';

interface GroupedRelease {
  bucket: ReleaseBucket;
  label: string;
  games: Array<EnrichedGame & { parsedDate: string }>;
}

interface ReleaseTimelineProps {
  groups: GroupedRelease[];
}

export function ReleaseTimeline({ groups }: ReleaseTimelineProps) {
  const [search, setSearch] = useState('');

  const filteredGroups = search.trim()
    ? groups
        .map((group) => ({
          ...group,
          games: group.games.filter((g) =>
            g.title.toLowerCase().includes(search.toLowerCase())
          ),
        }))
        .filter((group) => group.games.length > 0)
    : groups;

  const totalFiltered = filteredGroups.reduce((sum, g) => sum + g.games.length, 0);

  return (
    <div className="space-y-6">
      {/* Search */}
      <input
        type="text"
        placeholder="Search upcoming games..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 rounded-md border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {totalFiltered === 0 && search.trim() ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground">
            No upcoming games match &quot;{search}&quot;
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <section key={group.bucket}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`h-px flex-1 ${group.bucket === 'overdue' ? 'bg-amber-500/30' : 'bg-border'}`} />
                <h2 className={`text-sm font-semibold uppercase tracking-wider ${
                  group.bucket === 'overdue'
                    ? 'text-amber-500'
                    : 'text-muted-foreground'
                }`}>
                  {group.label}
                </h2>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  group.bucket === 'overdue'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-secondary text-muted-foreground'
                }`}>
                  {group.games.length}
                </span>
                <div className={`h-px flex-1 ${group.bucket === 'overdue' ? 'bg-amber-500/30' : 'bg-border'}`} />
              </div>

              {/* Game grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {group.games.map((game) => (
                  <GameCard key={game.id} game={game} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
