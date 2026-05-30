'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';

/** One game inside a "still at all-time low" digest notification. */
export interface DealDigestGame {
  gameId: number;
  title: string;
  currentPrice: number;
  discountPercent: number;
  store: string;
  storeUrl?: string | null;
}

/**
 * Pull the games array out of a digest notification's metadata, validating each
 * entry. Returns an empty array for anything that isn't a recognizable digest, so
 * callers can use a non-empty result both to detect a digest and to render it.
 */
export function parseDigestGames(metadata: Record<string, unknown> | null): DealDigestGame[] {
  if (!metadata || !Array.isArray(metadata.games)) return [];
  const games: DealDigestGame[] = [];
  for (const raw of metadata.games) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.gameId !== 'number' || typeof g.title !== 'string') continue;
    games.push({
      gameId: g.gameId,
      title: g.title,
      currentPrice: typeof g.currentPrice === 'number' ? g.currentPrice : 0,
      discountPercent: typeof g.discountPercent === 'number' ? g.discountPercent : 0,
      store: typeof g.store === 'string' ? g.store : '',
      storeUrl: typeof g.storeUrl === 'string' ? g.storeUrl : null,
    });
  }
  return games;
}

interface DealDigestModalProps {
  /** Non-null opens the modal; null keeps it closed. */
  games: DealDigestGame[] | null;
  onClose: () => void;
}

export function DealDigestModal({ games, onClose }: DealDigestModalProps) {
  const open = games !== null && games.length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-white/[0.08] bg-card shadow-xl shadow-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-200">
          <div className="flex items-start justify-between border-b border-white/[0.06] px-5 pt-5 pb-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                {games?.length ?? 0} game{(games?.length ?? 0) === 1 ? '' : 's'} still at all-time low
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                Still discounted at their lowest tracked price.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <ul className="flex-1 overflow-y-auto px-2 py-2">
            {games?.map((g) => (
              <li key={g.gameId} className="border-b border-white/[0.04] last:border-b-0">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Link
                    href={`/games/${g.gameId}`}
                    onClick={onClose}
                    className="min-w-0 flex-1 hover:text-primary transition-colors"
                  >
                    <p className="truncate text-sm font-medium leading-tight">{g.title}</p>
                    {g.store && (
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {g.store}
                      </p>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <span className="text-sm font-label font-bold tabular-nums text-deal-great">
                        {g.currentPrice === 0 ? 'Free' : `$${g.currentPrice.toFixed(2)}`}
                      </span>
                      {g.discountPercent > 0 && (
                        <span className="ml-1 text-[10px] font-label font-bold text-deal-good">
                          -{g.discountPercent}%
                        </span>
                      )}
                    </div>
                    {g.storeUrl && (
                      <a
                        href={g.storeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                        aria-label={`Open ${g.title} on ${g.store}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
