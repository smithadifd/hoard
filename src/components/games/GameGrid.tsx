import type { EnrichedGame } from '@/types';
import type { GameDetailOrigin } from '@/lib/utils/backNav';
import { GameCard } from './GameCard';

interface GameGridProps {
  games: EnrichedGame[];
  emptyMessage?: string;
  /** Origin list — propagated to each card's detail link for back-navigation. */
  from?: GameDetailOrigin;
}

export function GameGrid({ games, emptyMessage = 'No games found', from }: GameGridProps) {
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
        <GameCard key={game.id} game={game} from={from} />
      ))}
    </div>
  );
}
