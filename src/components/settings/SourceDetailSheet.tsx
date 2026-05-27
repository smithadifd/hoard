'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription } from '@/components/ui/Sheet';
import type { SourceDetailResponse, Health, SyncRunRow } from '@/lib/sync/api-types';

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

const STATUS_COLORS = {
  success: '#22c55e',
  partial: '#FACC15',
  error: '#ef4444',
};

const MUTED_FG = '#D8C3AD';
const CARD_BG = '#201F1F';
const BORDER_COLOR = '#2A2A2A';

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '–';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'success'
      ? 'text-emerald-500'
      : status === 'partial'
        ? 'text-amber-500'
        : status === 'error'
          ? 'text-destructive'
          : 'text-muted-foreground';
  return <span className={`text-xs font-medium ${color}`}>{status}</span>;
}

interface RollupTooltipPayload {
  payload: {
    day: string;
    succeeded: number;
    partial: number;
    errored: number;
    total: number;
  };
}

function RollupTooltip({ active, payload }: { active?: boolean; payload?: RollupTooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg border border-white/[0.08]" style={{ backgroundColor: CARD_BG }}>
      <div className="font-medium mb-1">{p.day}</div>
      <div style={{ color: MUTED_FG }}>
        <div>Success: {p.succeeded}</div>
        {p.partial > 0 && <div className="text-amber-500">Partial: {p.partial}</div>}
        {p.errored > 0 && <div className="text-destructive">Failed: {p.errored}</div>}
      </div>
    </div>
  );
}

function RunsTable({ runs }: { runs: SyncRunRow[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No runs recorded.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-white/[0.06]">
      <table className="w-full text-xs">
        <thead className="bg-white/[0.02]">
          <tr className="text-left text-muted-foreground border-b border-white/[0.06]">
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Items</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">API</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatFullDate(r.startedAt)}</td>
              <td className="px-3 py-2">
                <StatusPill status={r.status} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.itemsAttempted && r.itemsAttempted > 0
                  ? `${r.itemsProcessed ?? 0}/${r.itemsAttempted}`
                  : (r.itemsProcessed ?? 0)}
                {r.itemsFailed != null && r.itemsFailed > 0 && (
                  <span className="text-amber-500 ml-1">({r.itemsFailed} failed)</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatDuration(r.startedAt, r.completedAt)}</td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">
                {r.apiCalls != null ? r.apiCalls.toLocaleString() : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorsPanel({ runs }: { runs: SyncRunRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const errors = runs.filter((r) => r.errorMessage && r.errorMessage.trim().length > 0);
  if (errors.length === 0) return null;
  return (
    <div className="rounded-md border border-red-500/20 bg-red-500/[0.04]">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="font-medium">{errors.length} error{errors.length === 1 ? '' : 's'} in last 50 runs</span>
      </button>
      {expanded && (
        <ul className="border-t border-red-500/20 px-4 py-3 space-y-2">
          {errors.map((e) => (
            <li key={e.id} className="text-xs">
              <div className="text-muted-foreground">{formatFullDate(e.startedAt)}</div>
              <div className="text-destructive break-words">{e.errorMessage}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SourceDetailSheetProps {
  sourceKey: string | null;
  health: Health;
  onClose: () => void;
}

export function SourceDetailSheet({ sourceKey, health, onClose }: SourceDetailSheetProps) {
  const open = sourceKey !== null;
  const [data, setData] = useState<SourceDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceKey) return;
    let cancelled = false;
    fetch(`/api/sync/sources/${encodeURIComponent(sourceKey)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData(json.data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  const dataMatches = data?.source === sourceKey;
  const showLoading = sourceKey !== null && !dataMatches && error === null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[health]}`} />
            <SheetTitle>{data?.label ?? sourceKey ?? 'Sync source'}</SheetTitle>
            <span className={`text-xs font-medium ${HEALTH_TEXT[health]}`}>{HEALTH_LABEL[health]}</span>
          </div>
          {data && (
            <SheetDescription>
              {data.description}
              {data.threshold !== null && (
                <span className="block mt-1 text-xs">
                  Alert if success rate &lt; {Math.round(data.threshold * 100)}% over {data.minAttempts}+ attempts
                </span>
              )}
            </SheetDescription>
          )}
        </SheetHeader>

        <SheetBody className="space-y-6">
          {showLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {data && dataMatches && (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  14-day activity
                </h3>
                {data.dailyRollup.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No runs in the last 14 days.</p>
                ) : (
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.dailyRollup}
                        margin={{ top: 4, right: 4, bottom: 0, left: -28 }}
                      >
                        <CartesianGrid stroke={BORDER_COLOR} strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="day"
                          tick={{ fill: MUTED_FG, fontSize: 11 }}
                          axisLine={{ stroke: BORDER_COLOR }}
                          tickLine={false}
                          tickFormatter={(d) => (typeof d === 'string' ? d.slice(5) : d)}
                        />
                        <YAxis
                          tick={{ fill: MUTED_FG, fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip content={<RollupTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="succeeded" stackId="a" fill={STATUS_COLORS.success} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="partial" stackId="a" fill={STATUS_COLORS.partial} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="errored" stackId="a" fill={STATUS_COLORS.error} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              <ErrorsPanel runs={data.runs} />

              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent runs ({data.runs.length})
                </h3>
                <RunsTable runs={data.runs} />
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
