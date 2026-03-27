'use client';

import { useEffect, useState } from 'react';
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
import { TrendingDown } from 'lucide-react';

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
  { label: 'All', days: Infinity },
] as const;

// Colors from tailwind.config.ts (Recharts needs raw values, not Tailwind classes)
const PRIMARY_AMBER = '#F59E0B';
const TEAL = '#14B8A6';
const MUTED_FG = '#D8C3AD';
const BORDER_COLOR = '#2A2A2A'; // surface-high
const CARD_BG = '#201F1F'; // card

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
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

export function PriceHistoryChart({ gameId }: PriceHistoryChartProps) {
  const [data, setData] = useState<PriceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState(90);

  useEffect(() => {
    fetch(`/api/games/${gameId}/prices?limit=365`)
      .then(res => res.json())
      .then(json => {
        // API returns DESC order; reverse for chronological chart
        setData((json.data ?? []).reverse());
      })
      .catch(() => setError('Failed to load price history'))
      .finally(() => setLoading(false));
  }, [gameId]);

  if (loading) return <ChartSkeleton />;
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;

  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <TrendingDown className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Price tracking just started for this game.</p>
        <p className="text-xs mt-1">
          Data is collected daily — check back in a few days to see trends.
        </p>
      </div>
    );
  }

  const now = new Date();
  const filteredData = selectedRange === Infinity
    ? data
    : data.filter(d => daysBetween(new Date(d.snapshotDate + 'T00:00:00'), now) <= selectedRange);

  // Use filteredData if it has enough points, otherwise fall back to all data
  const chartData = filteredData.length >= 2 ? filteredData : data;

  const historicalLow = data[0]?.historicalLowPrice;

  return (
    <div>
      {/* Time range selector */}
      <div className="flex gap-1 mb-3">
        {RANGES.map(range => (
          <button
            key={range.label}
            onClick={() => setSelectedRange(range.days)}
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

      {/* Legend */}
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
              tickFormatter={formatDate}
              tick={{ fill: MUTED_FG, fontSize: 12 }}
              stroke={BORDER_COLOR}
            />
            <YAxis
              tickFormatter={v => `$${v}`}
              tick={{ fill: MUTED_FG, fontSize: 12 }}
              stroke={BORDER_COLOR}
              domain={['auto', 'auto']}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Regular price line (dashed, subtle) */}
            <Area
              type="stepAfter"
              dataKey="priceRegular"
              stroke={MUTED_FG}
              strokeDasharray="4 4"
              fill="none"
              name="Regular"
            />

            {/* Current/sale price area (filled, prominent) */}
            <Area
              type="stepAfter"
              dataKey="priceCurrent"
              stroke={PRIMARY_AMBER}
              fill={PRIMARY_AMBER}
              fillOpacity={0.15}
              strokeWidth={2}
              name="Price"
            />

            {/* Historical low reference line (label in legend, not on chart) */}
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
