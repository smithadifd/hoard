'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import type { SourceEntry, ApiCallsByService, Health } from '@/lib/sync/api-types';

const STEAM_COLOR = '#66c0f4';
const ITAD_COLOR = '#F59E0B';
const HLTB_COLOR = '#14B8A6';

const HEALTH_LABEL: Record<Health, string> = {
  healthy: 'All systems healthy',
  degraded: 'Some sources degraded',
  unhealthy: 'Sources need attention',
  unknown: 'Awaiting first runs',
};

const HEALTH_DOT: Record<Health, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-muted-foreground',
};

function aggregateOverallHealth(sources: SourceEntry[]): Health {
  if (sources.length === 0) return 'unknown';
  if (sources.some((s) => s.health === 'unhealthy')) return 'unhealthy';
  if (sources.some((s) => s.health === 'degraded')) return 'degraded';
  if (sources.every((s) => s.health === 'unknown')) return 'unknown';
  return 'healthy';
}

/**
 * Build a 7-day sparkline for a service bucket by summing `apiCalls`
 * across all sources in that service, bucketed by ISO date.
 *
 * `recentStats` is newest-first; we group by UTC day and sort ascending.
 */
function serviceSparklineData(
  sources: SourceEntry[],
  service: 'steam' | 'itad' | 'hltb',
  nowMs: number,
) {
  const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
  const byDay = new Map<string, number>();

  for (const src of sources) {
    if (src.service !== service) continue;
    for (const stat of src.recentStats) {
      const ts = new Date(stat.startedAt).getTime();
      if (ts < sevenDaysAgo) continue;
      const day = stat.startedAt.slice(0, 10); // YYYY-MM-DD
      byDay.set(day, (byDay.get(day) ?? 0) + (stat.apiCalls ?? 0));
    }
  }

  // Fill all 7 days so the sparkline has a stable baseline
  const days: { day: string; calls: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, calls: byDay.get(key) ?? 0 });
  }
  return days;
}

interface ServiceCardProps {
  label: string;
  total: number;
  color: string;
  data: { day: string; calls: number }[];
}

function ServiceCard({ label, total, color, data }: ServiceCardProps) {
  const gradientId = `grad-${label.toLowerCase()}`;
  return (
    <div className="rounded-lg border border-white/[0.06] bg-card/60 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">7d</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{total.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground mb-2">API calls</div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="calls"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface SystemTopStatusProps {
  sources: SourceEntry[];
  apiCallsByService7d: ApiCallsByService;
  /** Reference timestamp from when the parent loaded `sources`. */
  loadedAtMs: number;
}

export function SystemTopStatus({ sources, apiCallsByService7d, loadedAtMs }: SystemTopStatusProps) {
  const overall = aggregateOverallHealth(sources);

  const counts = sources.reduce(
    (acc, s) => {
      acc[s.health]++;
      return acc;
    },
    { healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 } as Record<Health, number>
  );

  const sparklines = useMemo(
    () => ({
      steam: serviceSparklineData(sources, 'steam', loadedAtMs),
      itad: serviceSparklineData(sources, 'itad', loadedAtMs),
      hltb: serviceSparklineData(sources, 'hltb', loadedAtMs),
    }),
    [sources, loadedAtMs],
  );

  return (
    <section className="rounded-xl bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">System Health</h2>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-4 py-3">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${HEALTH_DOT[overall]}`} />
        <div className="flex-1">
          <div className="text-sm font-medium">{HEALTH_LABEL[overall]}</div>
          <div className="text-xs text-muted-foreground">
            {counts.healthy} healthy
            {counts.degraded > 0 && <> &middot; {counts.degraded} degraded</>}
            {counts.unhealthy > 0 && <> &middot; {counts.unhealthy} unhealthy</>}
            {counts.unknown > 0 && <> &middot; {counts.unknown} awaiting data</>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ServiceCard
          label="Steam"
          total={apiCallsByService7d.steam}
          color={STEAM_COLOR}
          data={sparklines.steam}
        />
        <ServiceCard
          label="ITAD"
          total={apiCallsByService7d.itad}
          color={ITAD_COLOR}
          data={sparklines.itad}
        />
        <ServiceCard
          label="HLTB"
          total={apiCallsByService7d.hltb}
          color={HLTB_COLOR}
          data={sparklines.hltb}
        />
      </div>
    </section>
  );
}
