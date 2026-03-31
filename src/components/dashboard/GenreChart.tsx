'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface GenreChartProps {
  data: Array<{ name: string; count: number }>;
}

// Palette derived from tailwind.config.ts design tokens
const COLORS = [
  '#F59E0B', // gold/primary
  '#14B8A6', // teal
  '#22c55e', // green
  '#3B82F6', // blue
  '#A855F7', // purple
  '#EC4899', // pink
  '#F97316', // orange
  '#6366F1', // indigo
];

const CARD_BG = '#201F1F';
const MUTED_FG = '#D8C3AD';

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; count: number } }> }) {
  if (!active || !payload?.length) return null;
  const { name, count } = payload[0].payload;
  return (
    <div
      className="rounded-lg px-3 py-2 text-sm shadow-lg border border-white/[0.08]"
      style={{ backgroundColor: CARD_BG }}
    >
      <span className="font-medium">{name}</span>
      <span className="ml-2" style={{ color: MUTED_FG }}>{count} games</span>
    </div>
  );
}

export default function GenreChart({ data }: GenreChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No genre data yet
      </div>
    );
  }

  const chartHeight = Math.max(200, data.length * 32);

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: MUTED_FG, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: MUTED_FG, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
