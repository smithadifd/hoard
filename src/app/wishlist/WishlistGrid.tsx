import { GameGrid } from '@/components/games/GameGrid';
import type { EnrichedGame } from '@/types';

interface WishlistGridProps {
  games: EnrichedGame[];
  emptyMessage: string;
}

export function WishlistGrid({ games, emptyMessage }: WishlistGridProps) {
  return <GameGrid games={games} emptyMessage={emptyMessage} />;
}
