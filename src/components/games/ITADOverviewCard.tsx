'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, TrendingDown } from 'lucide-react';
import type { ITADOverviewPrice } from '@/lib/itad/types';

interface ITADOverviewCardProps {
  gameId: number;
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="h-3.5 w-24 rounded bg-surface-high animate-pulse" />
      <div className="h-3.5 w-16 rounded bg-surface-high animate-pulse" />
    </div>
  );
}

/**
 * Client component that fetches live ITAD pricing for a game.
 * Used in lookup mode as a replacement for the local PriceHistoryChart.
 */
export function ITADOverviewCard({ gameId }: ITADOverviewCardProps) {
  const [data, setData] = useState<ITADOverviewPrice | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchOverview() {
      try {
        const res = await fetch(`/api/games/${gameId}/itad-overview`);
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const body = await res.json();
        if (!cancelled) setData((body as { data: ITADOverviewPrice | null }).data ?? null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchOverview();
    return () => { cancelled = true; };
  }, [gameId]);

  const currentPrice = data?.current?.price?.amount;
  const currentShop = data?.current?.shop?.name;
  const currentUrl = data?.current?.url;
  const lowestPrice = data?.lowest?.price?.amount;
  const lowestShop = data?.lowest?.shop?.name;
  const lowestDate = data?.lowest?.timestamp
    ? new Date(data.lowest.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  const discountVsAtl =
    currentPrice !== undefined && lowestPrice !== undefined && lowestPrice > 0 && currentPrice > lowestPrice
      ? Math.round(((currentPrice - lowestPrice) / lowestPrice) * 100)
      : null;

  const isAtAtl =
    currentPrice !== undefined && lowestPrice !== undefined && currentPrice <= lowestPrice;

  return (
    <section className="rounded-xl bg-card p-5 space-y-3">
      <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">
        Current Pricing
      </h2>

      {loading && (
        <div>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && data === null && (
        <p className="text-sm text-muted-foreground">No ITAD pricing data available for this game.</p>
      )}

      {!loading && data !== null && data !== undefined && (
        <div className="space-y-3">
          {/* Current best price */}
          {currentPrice !== undefined ? (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-2xl font-bold">
                  {currentPrice === 0 ? 'Free' : `$${currentPrice.toFixed(2)}`}
                </div>
                {currentShop && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Best price at{' '}
                    {currentUrl ? (
                      <a
                        href={currentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        {currentShop}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="text-foreground">{currentShop}</span>
                    )}
                  </div>
                )}
              </div>

              {isAtAtl && (
                <span className="px-2 py-1 rounded-md bg-deal-great/10 text-deal-great text-xs font-bold border border-deal-great/20">
                  At ATL!
                </span>
              )}
              {discountVsAtl !== null && (
                <span className="text-xs text-muted-foreground">
                  +{discountVsAtl}% above ATL
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No current deals found.</p>
          )}

          {/* All-time low */}
          {lowestPrice !== undefined && (
            <div className="pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5" />
                <span>
                  All-time low:{' '}
                  <span className="text-foreground font-medium">
                    {lowestPrice === 0 ? 'Free' : `$${lowestPrice.toFixed(2)}`}
                  </span>
                  {lowestShop && <span> at {lowestShop}</span>}
                  {lowestDate && <span className="ml-1 text-muted-foreground/70">({lowestDate})</span>}
                </span>
              </div>
            </div>
          )}

          {/* ITAD page link */}
          {data.urls?.game && (
            <div className="pt-1">
              <a
                href={data.urls.game}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View all prices on IsThereAnyDeal
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
