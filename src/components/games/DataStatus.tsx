'use client';

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

function formatTimeAgo(dateStr: string, now: number): string {
  const diff = now - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

function DataStatusRow({ label, dateStr, now }: { label: string; dateStr?: string; now: number }) {
  if (!dateStr) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1 text-muted-foreground/60">
          <XCircle className="h-3 w-3" />
          No data
        </span>
      </div>
    );
  }

  const days = Math.floor((now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  const isStale = days > 7;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1 ${isStale ? 'text-amber-500' : 'text-steam-green'}`}>
        {isStale ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
        {formatTimeAgo(dateStr, now)}
      </span>
    </div>
  );
}

export function DataStatus({
  reviewLastUpdated,
  hltbLastUpdated,
  priceLastUpdated,
}: {
  reviewLastUpdated?: string;
  hltbLastUpdated?: string;
  priceLastUpdated?: string;
}) {
  const [now] = useState(() => Date.now());

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h2 className="text-sm font-semibold">Data Status</h2>
      <DataStatusRow label="Reviews" dateStr={reviewLastUpdated} now={now} />
      <DataStatusRow label="Duration (HLTB)" dateStr={hltbLastUpdated} now={now} />
      <DataStatusRow label="Prices" dateStr={priceLastUpdated} now={now} />
    </section>
  );
}
