'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

const STALE_THRESHOLDS: Record<string, { label: string; hours: number }> = {
  steam_library: { label: 'Library', hours: 48 },
  steam_wishlist: { label: 'Wishlist', hours: 48 },
  itad_prices: { label: 'Prices', hours: 24 },
  hltb: { label: 'HLTB', hours: 336 }, // 14 days
};

export function StaleDataBanner() {
  const [staleItems, setStaleItems] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        const now = Date.now();
        const stale: string[] = [];
        const lastSyncs = data.checks?.lastSyncs ?? {};

        for (const [source, config] of Object.entries(STALE_THRESHOLDS)) {
          const lastSync = lastSyncs[source];
          if (!lastSync) {
            stale.push(config.label);
            continue;
          }
          const age = now - new Date(lastSync as string).getTime();
          if (age > config.hours * 60 * 60 * 1000) {
            stale.push(config.label);
          }
        }
        setStaleItems(stale);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (staleItems.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-yellow-500 bg-yellow-500/10 border-b border-yellow-500/20">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        Stale data: {staleItems.join(', ')} sync{staleItems.length > 1 ? 's are' : ' is'} overdue
      </span>
    </div>
  );
}
