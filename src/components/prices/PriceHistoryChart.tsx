'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { Download, TrendingDown } from 'lucide-react';
import { useApiMutation } from '@/hooks/useApiMutation';

interface PriceSnapshot {
  snapshotDate: string;
  priceCurrent: number;
  priceRegular: number;
  historicalLowPrice: number | null;
  store: string;
  discountPercent: number;
}

interface PriceHistoryChartProps {
  gameId: number;
}

const RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
  { label: '2y', days: 365 * 2 },
  { label: '5y', days: 365 * 5 },
  { label: 'All', days: Infinity },
] as const;

const BACKFILL_DEPTHS = [
  { label: '1 year', value: '1y' },
  { label: '3 years', value: '3y' },
  { label: 'All available', value: 'all' },
] as const;

type BackfillDepth = (typeof BACKFILL_DEPTHS)[number]['value'];

const PRIMARY_AMBER = '#F59E0B';
const TEAL = '#14B8A6';
const MUTED_FG = '#D8C3AD';
const BORDER_COLOR = '#2A2A2A';
const CARD_BG = '#201F1F';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthYear(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatYear(dateStr: string): string {
  return dateStr.slice(0, 4);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Monday-start ISO week key (YYYY-MM-DD of the Monday). */
function weekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-01 month key. */
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Bucket snapshots by week or month for long ranges, picking the minimum sale
 * price and median regular price per bucket. Preserves the chronological order
 * Recharts expects.
 */
function bucketSnapshots(
  snapshots: PriceSnapshot[],
  granularity: 'day' | 'week' | 'month',
): PriceSnapshot[] {
  if (granularity === 'day') return snapshots;

  const keyFn = granularity === 'week' ? weekKey : monthKey;
  const buckets = new Map<string, PriceSnapshot[]>();
  for (const s of snapshots) {
    const key = keyFn(s.snapshotDate);
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }

  const result: PriceSnapshot[] = [];
  for (const [key, list] of Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const minSale = Math.min(...list.map((s) => s.priceCurrent));
    const minSnapshot = list.find((s) => s.priceCurrent === minSale)!;
    result.push({
      snapshotDate: key,
      priceCurrent: minSale,
      priceRegular: median(list.map((s) => s.priceRegular)),
      historicalLowPrice: minSnapshot.historicalLowPrice,
      store: minSnapshot.store,
      discountPercent: minSnapshot.discountPercent,
    });
  }
  return result;
}

function sinceFor(depth: BackfillDepth): string {
  if (depth === 'all') return 'all';
  const now = new Date();
  if (depth === '1y') now.setFullYear(now.getFullYear() - 1);
  else if (depth === '3y') now.setFullYear(now.getFullYear() - 3);
  return now.toISOString();
}

interface TooltipPayloadItem {
  dataKey: string;
  value: number;
  name: string;
  color: string;
  payload: PriceSnapshot;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const snapshot = payload[0].payload;
  const hasDiscount = snapshot.discountPercent > 0;

  return (
    <div
      className="rounded-md border border-white/[0.08] px-3 py-2 text-xs shadow-md"
      style={{ backgroundColor: CARD_BG }}
    >
      <p className="font-medium text-foreground mb-1">
        {label ? formatDate(label) : ''}
      </p>
      <div className="space-y-0.5">
        <p style={{ color: PRIMARY_AMBER }}>
          Price: ${snapshot.priceCurrent.toFixed(2)}
          {hasDiscount && (
            <span className="text-muted-foreground ml-1">
              (-{snapshot.discountPercent}%)
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          Regular: ${snapshot.priceRegular.toFixed(2)}
        </p>
        <p className="text-muted-foreground">Store: {snapshot.store}</p>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="w-full h-64 animate-pulse bg-muted rounded" />;
}

interface BackfillResponse {
  data: {
    gameId: number;
    events: number;
    inserted: number;
    skipped: number;
  };
}

function BackfillControl({
  gameId,
  onComplete,
  hasExistingData = false,
}: {
  gameId: number;
  onComplete: () => void;
  hasExistingData?: boolean;
}) {
  const [depth, setDepth] = useState<BackfillDepth>('all');
  const [message, setMessage] = useState<string | null>(null);

  const { mutate, isPending, error } = useApiMutation<
    { since: string },
    BackfillResponse
  >(`/api/games/${gameId}/prices/history`, {
    onSuccess: (resp) => {
      const { inserted, events } = resp.data;
      setMessage(
        inserted > 0
          ? `Added ${inserted} price point${inserted === 1 ? '' : 's'} (${events} events scanned).`
          : `No new data — history is already up to date.`
      );
      onComplete();
    },
  });

  const idleLabel = hasExistingData ? 'Refresh from ITAD' : 'Backfill from ITAD';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={depth}
        onChange={(e) => setDepth(e.target.value as BackfillDepth)}
        disabled={isPending}
        className="rounded-md border border-white/[0.08] bg-card px-2 py-1 text-xs"
        aria-label="Backfill depth"
      >
        {BACKFILL_DEPTHS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          mutate({ since: sinceFor(depth) });
        }}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" />
        {isPending ? 'Backfilling…' : idleLabel}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
      {message && !error && (
        <span className="text-xs text-muted-foreground">{message}</span>
      )}
    </div>
  );
}

export function PriceHistoryChart({ gameId }: PriceHistoryChartProps) {
  const [data, setData] = useState<PriceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `userSelectedRange === null` means "follow auto-default" (widest range that fits the data).
  const [userSelectedRange, setUserSelectedRange] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/games/${gameId}/prices?limit=5000`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        setData((json.data ?? []).reverse());
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load price history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [gameId, reloadKey]);

  // Compute auto-default range from data span. The user's explicit pick wins when present.
  const autoDefaultRange = useMemo(() => {
    if (data.length < 2) return 90;
    const span = daysBetween(new Date(data[0].snapshotDate + 'T00:00:00'), new Date());
    let target = 30;
    for (const r of RANGES) {
      if (r.days === Infinity) {
        if (span > 365 * 5) target = Infinity;
        continue;
      }
      if (r.days <= span) target = r.days;
    }
    return target;
  }, [data]);

  const selectedRange = userSelectedRange ?? autoDefaultRange;

  // Bucket long ranges: weekly for >1y, monthly for >3y. Done unconditionally so
  // the hook order is stable across loading/empty/data states.
  const { chartData, granularity, hasData } = useMemo(() => {
    const now = new Date();
    const filtered = selectedRange === Infinity
      ? data
      : data.filter(d => daysBetween(new Date(d.snapshotDate + 'T00:00:00'), now) <= selectedRange);
    const raw = filtered.length >= 2 ? filtered : data;
    if (raw.length < 2) {
      return { chartData: raw, granularity: 'day' as const, hasData: false };
    }
    const span = daysBetween(
      new Date(raw[0].snapshotDate + 'T00:00:00'),
      new Date(raw[raw.length - 1].snapshotDate + 'T00:00:00'),
    );
    const g: 'day' | 'week' | 'month' = span > 365 * 3 ? 'month' : span > 365 ? 'week' : 'day';
    return { chartData: bucketSnapshots(raw, g), granularity: g, hasData: true };
  }, [data, selectedRange]);

  const handleRangeClick = useCallback((days: number) => {
    setUserSelectedRange(days);
  }, []);

  const handleBackfillComplete = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  if (loading) return <ChartSkeleton />;
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  if (!hasData && data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-muted-foreground">
        <TrendingDown className="h-8 w-8 opacity-50" />
        <div>
          <p className="text-sm">Price tracking just started for this game.</p>
          <p className="text-xs mt-1">
            Pull in ITAD&apos;s historical prices to see trends right away:
          </p>
        </div>
        <BackfillControl gameId={gameId} onComplete={handleBackfillComplete} />
      </div>
    );
  }

  const tickFormatter =
    granularity === 'month' ? formatYear : granularity === 'week' ? formatMonthYear : formatDate;

  const earliestDate = data[0]?.snapshotDate;
  const earliestLabel = earliestDate
    ? new Date(earliestDate + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      })
    : null;

  // Find the most recent non-null historicalLowPrice (older backfilled rows leave it null)
  const historicalLow = (() => {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].historicalLowPrice != null) return data[i].historicalLowPrice;
    }
    return null;
  })();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {RANGES.map(range => (
            <button
              key={range.label}
              onClick={() => handleRangeClick(range.days)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                selectedRange === range.days
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        <BackfillControl
          gameId={gameId}
          onComplete={handleBackfillComplete}
          hasExistingData
        />
      </div>

      {earliestLabel && (
        <p className="text-xs text-muted-foreground mb-2">
          Historical data from {earliestLabel}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: PRIMARY_AMBER }} />
          Sale Price
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded border-t border-dashed" style={{ borderColor: MUTED_FG }} />
          Regular Price
        </span>
        {historicalLow != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded border-t border-dashed" style={{ borderColor: TEAL }} />
            All-Time Low (${historicalLow.toFixed(2)})
          </span>
        )}
      </div>

      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER_COLOR} />
            <XAxis
              dataKey="snapshotDate"
              tickFormatter={tickFormatter}
              tick={{ fill: MUTED_FG, fontSize: 12 }}
              stroke={BORDER_COLOR}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={v => `$${v}`}
              tick={{ fill: MUTED_FG, fontSize: 12 }}
              stroke={BORDER_COLOR}
              domain={['auto', 'auto']}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />

            <Area
              type="stepAfter"
              dataKey="priceRegular"
              stroke={MUTED_FG}
              strokeDasharray="4 4"
              fill="none"
              name="Regular"
            />

            <Area
              type="stepAfter"
              dataKey="priceCurrent"
              stroke={PRIMARY_AMBER}
              fill={PRIMARY_AMBER}
              fillOpacity={0.15}
              strokeWidth={2}
              name="Price"
            />

            {historicalLow != null && (
              <ReferenceLine
                y={historicalLow}
                stroke={TEAL}
                strokeDasharray="6 3"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
