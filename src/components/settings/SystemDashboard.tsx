'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { SystemTopStatus } from './SystemTopStatus';
import { SourceHealthCard } from './SourceHealthCard';
import { SourceDetailSheet } from './SourceDetailSheet';
import type { SourceEntry, SourcesResponse, Health } from '@/lib/sync/api-types';

export function SystemDashboard() {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loadedAtMs, setLoadedAtMs] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/sources');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json.data as SourcesResponse);
      setLoadedAtMs(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading system status…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl bg-card p-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const openSourceHealth: Health = (() => {
    if (!openSource) return 'unknown';
    return data.sources.find((s) => s.source === openSource)?.health ?? 'unknown';
  })();

  return (
    <>
      <SystemTopStatus
        sources={data.sources}
        apiCallsByService7d={data.apiCallsByService7d}
        loadedAtMs={loadedAtMs}
      />

      <section className="rounded-xl bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Sync Sources</h2>
            <p className="text-sm text-muted-foreground">
              Click a card to see runs, errors, and 14-day activity.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-card/80 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-white/[0.16] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.sources.map((source) => (
            <SourceHealthCard
              key={source.source}
              source={source}
              onOpen={() => setOpenSource(source.source)}
              onRunComplete={() => {
                void load();
              }}
            />
          ))}
        </div>
      </section>

      <SourceDetailSheet
        sourceKey={openSource}
        health={openSourceHealth}
        onClose={() => setOpenSource(null)}
      />
    </>
  );
}

export type { SourceEntry };
