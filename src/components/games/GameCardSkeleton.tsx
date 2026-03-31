export function GameCardSkeleton() {
  return (
    <div className="rounded-xl bg-card overflow-hidden animate-pulse">
      {/* Header image area — matches aspect-[460/215] */}
      <div className="aspect-[460/215] bg-surface-lowest" />
      {/* Info block */}
      <div className="p-3 space-y-2">
        <div className="h-4 bg-surface-lowest rounded w-3/4" />
        <div className="h-3 bg-surface-lowest rounded w-1/2" />
        <div className="h-3 bg-surface-lowest rounded w-1/3" />
      </div>
    </div>
  );
}
