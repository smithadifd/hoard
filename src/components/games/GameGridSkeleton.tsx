import { GameCardSkeleton } from './GameCardSkeleton';

interface GameGridSkeletonProps {
  count?: number;
}

export function GameGridSkeleton({ count = 8 }: GameGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  );
}
