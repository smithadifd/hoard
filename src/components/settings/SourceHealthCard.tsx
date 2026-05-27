'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, YAxis } from 'recharts';
import { readSSEStream } from '@/lib/utils/sse';
import { iconForSource } from '@/lib/sync/source-icons';
import type { SourceEntry, Health } from '@/lib/sync/api-types';

const HEALTH_DOT: Record<Health, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-muted-foreground',
};

const HEALTH_TEXT: Record<Health, string> = {
  healthy: 'text-emerald-500',
  degraded: 'text-amber-500',
  unhealthy: 'text-red-500',
  unknown: 'text-muted-foreground',
};

const HEALTH_LABEL: Record<Health, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'No data',
};

const HEALTH_RING: Record<Health, string> = {
  healthy: 'border-white/[0.06]',
  degraded: 'border-amber-500/40',
  unhealthy: 'border-red-500/50',
  unknown: 'border-white/[0.06]',
};

function formatRelativeTime(iso: string | null | undefined, mode: 'past' | 'future' = 'past'): string {
  if (!iso) return 'never';
  const diffMs = mode === 'past' ? Date.now() - new Date(iso).getTime() : new Date(iso).getTime() - Date.now();
  if (diffMs < 0 && mode === 'future') return 'now';
  if (diffMs < 60_000) return mode === 'past' ? 'just now' : 'soon';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function successRate14d(stats: SourceEntry['recentStats']): { rate: number | null; processed: number; attempted: number } {
  let processed = 0;
  let attempted = 0;
  for (const s of stats) {
    processed += s.itemsProcessed ?? 0;
    attempted += s.itemsAttempted ?? 0;
  }
  if (attempted === 0) return { rate: null, processed, attempted };
  return { rate: processed / attempted, processed, attempted };
}

interface SourceHealthCardProps {
  source: SourceEntry;
  onOpen: () => void;
  onRunComplete: () => void;
}

export function SourceHealthCard({ source, onOpen, onRunComplete }: SourceHealthCardProps) {
  const Icon = iconForSource(source.source);
  const { rate, attempted } = successRate14d(source.recentStats);
  const taskRunning = source.task?.isRunning ?? false;

  const [running, setRunning] = useState(taskRunning);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sparkline data: per-run success rate (oldest → newest)
  const sparklineData = source.recentStats
    .slice()
    .reverse()
    .map((s, i) => {
      const att = s.itemsAttempted ?? 0;
      const proc = s.itemsProcessed ?? 0;
      const r = att > 0 ? proc / att : null;
      return { i, rate: r, status: s.status };
    });

  const handleRun = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (running) return;
      if (!source.manualRunType) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setRunError(null);
      setProgressMsg('Starting…');

      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: source.manualRunType }),
          signal: controller.signal,
        });

        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('text/event-stream')) {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Run failed');
          setProgressMsg(`Synced ${data.data?.gamesProcessed ?? 0}`);
          onRunComplete();
          return;
        }

        await readSSEStream(res, {
          onProgress: ({ processed, total }) => {
            setProgressMsg(`${processed}/${total}`);
          },
          onDone: (processed, cancelled, message) => {
            setProgressMsg(message ?? (cancelled ? `Cancelled (${processed})` : `Synced ${processed}`));
            onRunComplete();
          },
          onError: (msg) => {
            setRunError(msg);
            setProgressMsg('');
          },
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setProgressMsg('Cancelled');
          return;
        }
        setRunError(err instanceof Error ? err.message : 'Run failed');
        setProgressMsg('');
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [running, source.manualRunType, onRunComplete]
  );

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    abortRef.current?.abort();
  }, []);

  const handleCardClick = useCallback(() => {
    onOpen();
  }, [onOpen]);

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    },
    [onOpen]
  );

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      className={`group relative cursor-pointer rounded-xl border bg-card/60 p-4 transition-colors hover:bg-card hover:border-white/[0.12] focus:outline-none focus:ring-2 focus:ring-ring ${HEALTH_RING[source.health]}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">{source.label}</span>
        </div>
        {source.supportsManualRun &&
          (running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-card/80 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-white/[0.16] transition-colors"
              title="Cancel run"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-card/80 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-white/[0.16] transition-colors"
              title="Run now"
            >
              <Play className="h-3 w-3" />
              Run
            </button>
          ))}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[source.health]}`} />
        <span className={`text-xs font-medium ${HEALTH_TEXT[source.health]}`}>{HEALTH_LABEL[source.health]}</span>
        {rate !== null && (
          <span className="text-xs text-muted-foreground ml-auto">
            {Math.round(rate * 100)}% over {attempted}
          </span>
        )}
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
        {source.lastRun ? (
          <div className="truncate">
            Last run: {formatRelativeTime(source.lastRun.startedAt)} ago
            {source.lastRun.itemsAttempted && source.lastRun.itemsAttempted > 0 && (
              <> &middot; {source.lastRun.itemsProcessed}/{source.lastRun.itemsAttempted}</>
            )}
          </div>
        ) : (
          <div>No runs recorded yet</div>
        )}
        {source.task?.nextRun && (
          <div className="truncate">
            Next: in {formatRelativeTime(source.task.nextRun, 'future')}
            <span className="ml-2 opacity-60">{source.task.schedule}</span>
          </div>
        )}
        {source.apiCalls24h > 0 && (
          <div>{source.apiCalls24h.toLocaleString()} API calls (24h)</div>
        )}
      </div>

      <div className="h-10">
        {sparklineData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparklineData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${source.source}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[0, 1]} />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#F59E0B"
                strokeWidth={1.5}
                fill={`url(#spark-${source.source})`}
                connectNulls
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center text-xs text-muted-foreground">
            Not enough data for trend
          </div>
        )}
      </div>

      {(running || progressMsg || runError) && (
        <div className="mt-2 text-xs flex items-center gap-2 min-h-[1rem]">
          {running && <Loader2 className="h-3 w-3 animate-spin text-amber-500" />}
          {runError ? (
            <span className="text-destructive truncate">{runError}</span>
          ) : (
            <span className="text-muted-foreground truncate">{progressMsg}</span>
          )}
        </div>
      )}
    </div>
  );
}
