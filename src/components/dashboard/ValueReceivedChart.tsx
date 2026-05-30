'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { ValueReceivedBucket } from '@/lib/db/queries';

interface ValueReceivedChartProps {
  data: Array<{ bucket: ValueReceivedBucket; count: number }>;
}

const BUCKET_META: Record<ValueReceivedBucket, { label: string; color: string }> = {
  exceeded: { label: 'Value Exceeded', color: '#14B8A6' }, // teal
  realized: { label: 'Value Realized', color: '#22c55e' }, // green
  approaching: { label: 'Approaching', color: '#FACC15' }, // yellow
  unrealized: { label: 'Unrealized', color: '#6b7280' }, // muted gray
  none: { label: 'No estimate', color: '#3f3f46' }, // darker gray
};

// Stable slice order, best → worst → unknown.
const ORDER: ValueReceivedBucket[] = ['exceeded', 'realized', 'approaching', 'unrealized', 'none'];

const CARD_BG = '#201F1F';
const MUTED_FG = '#D8C3AD';

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; value: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const { label, value } = payload[0].payload;
  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-lg border border-white/[0.08]"
      style={{ backgroundColor: CARD_BG }}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-2" style={{ color: MUTED_FG }}>
        {value} game{value === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export default function ValueReceivedChart({ data }: ValueReceivedChartProps) {
  const countMap = new Map(data.map((d) => [d.bucket, d.count]));
  const slices = ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_META[bucket].label,
    color: BUCKET_META[bucket].color,
    value: countMap.get(bucket) ?? 0,
  })).filter((s) => s.value > 0);

  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No owned games yet
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              stroke="none"
            >
              {slices.map((s) => (
                <Cell key={s.bucket} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-headline font-extrabold">{total}</span>
          <span className="text-[10px] font-label uppercase tracking-wider text-muted-foreground">owned</span>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5">
        {slices.map((s) => (
          <li key={s.bucket} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="font-label font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
