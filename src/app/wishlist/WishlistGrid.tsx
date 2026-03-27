'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameGrid } from '@/components/games/GameGrid';
import type { EnrichedGame } from '@/types';

interface WishlistGridProps {
  games: EnrichedGame[];
  emptyMessage: string;
}

export function WishlistGrid({ games: serverGames, emptyMessage }: WishlistGridProps) {
  const router = useRouter();
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [showSteamHint, setShowSteamHint] = useState<number | null>(null);
  const [removedTitle, setRemovedTitle] = useState('');

  const visibleGames = serverGames.filter((g) => !removedIds.has(g.id));

  const handleRemove = async (gameId: number) => {
    const game = serverGames.find((g) => g.id === gameId);
    if (!game) return;

    // Optimistic update: hide from local list immediately
    setRemovedIds((prev) => new Set(prev).add(gameId));
    setShowSteamHint(game.steamAppId);
    setRemovedTitle(game.title);
    setTimeout(() => setShowSteamHint(null), 8000);

    // Persist to server
    await fetch(`/api/games/${gameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isWishlisted: false }),
    });

    // Refresh server component data (updates counts, pagination, etc.)
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {showSteamHint !== null && (
        <div className="rounded-md border border-white/[0.08] bg-card px-4 py-3 text-sm flex items-center justify-between gap-4">
          <span className="text-muted-foreground">
            <span className="text-foreground font-medium">{removedTitle}</span> removed from your Hoard wishlist.
          </span>
          <a
            href={`https://store.steampowered.com/app/${showSteamHint}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-primary text-sm hover:underline"
          >
            Remove from Steam too
          </a>
        </div>
      )}
      <GameGrid games={visibleGames} emptyMessage={emptyMessage} onRemove={handleRemove} />
    </div>
  );
}
