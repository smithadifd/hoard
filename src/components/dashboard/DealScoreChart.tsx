'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface DealScoreChartProps {
  data: Array<{ bucket: string; count: number }>;
}

const BUCKET_COLORS: Record<string, string> = {
  Excellent: '#14B8A6', // teal
  Great: '#22c55e',     // green
  Good: '#FACC15',      // yellow
  Okay: '#F97316',      // orange
  Poor: '#ef4444',      // red
};

const CARD_BG = '#201F1F';
const MUTED_FG = '#D8C3AD';
const BORDER_COLOR = '#2A2A2A';

// Ensure all buckets are present even if count is 0
const ALL_BUCKETS = ['Poor', 'Okay', 'Good', 'Great', 'Excellent'];

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { bucket: string; count: number } }> }) {
  if (!active || !payload?.length) return null;
  const { bucket, count } = payload[0].payload;
  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-lg border border-white/[0.08]"
      style={{ backgroundColor: CARD_BG }}
    >
      <span className="font-medium">{bucket}</span>
      <span className="ml-2" style={{ color: MUTED_FG }}>{count} games</span>
    </div>
  );
}

export default function DealScoreChart({ data }: DealScoreChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No deal data yet
      </div>
    );
  }

  // Fill in missing buckets with 0
  const dataMap = new Map(data.map((d) => [d.bucket, d.count]));
  const filledData = ALL_BUCKETS.map((bucket) => ({
    bucket,
    count: dataMap.get(bucket) ?? 0,
  }));

  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filledData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="bucket"
            tick={{ fill: MUTED_FG, fontSize: 12 }}
            axisLine={{ stroke: BORDER_COLOR }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: MUTED_FG, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {filledData.map((entry) => (
              <Cell key={entry.bucket} fill={BUCKET_COLORS[entry.bucket] ?? '#888'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
