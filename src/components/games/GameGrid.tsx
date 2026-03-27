import type { EnrichedGame } from '@/types';
import { GameCard } from './GameCard';

interface GameGridProps {
  games: EnrichedGame[];
  emptyMessage?: string;
  onRemove?: (gameId: number) => void;
}

export function GameGrid({ games, emptyMessage = 'No games found', onRemove }: GameGridProps) {
  if (games.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] p-12 text-center text-muted-foreground">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {games.map((game) => (
        <GameCard key={game.id} game={game} onRemove={onRemove} />
      ))}
    </div>
  );
}
