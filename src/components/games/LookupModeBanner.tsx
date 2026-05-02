import { Info } from 'lucide-react';

/**
 * Subtle banner displayed on game detail pages in lookup mode
 * (games not in the user's library or wishlist).
 */
export function LookupModeBanner() {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-high border border-white/[0.06] text-sm text-muted-foreground">
      <Info className="h-4 w-4 flex-shrink-0 text-primary" />
      <span>
        Not in your library — wishlist to start tracking price history.
      </span>
    </div>
  );
}
