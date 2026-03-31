'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DollarSign, Heart, Gamepad2, ChevronDown, ChevronUp } from 'lucide-react';

interface ActivityItem {
  type: 'price_drop' | 'wishlisted' | 'played';
  gameId: number;
  title: string;
  detail: string;
  date: string;
}

interface RecentActivityFeedProps {
  items: ActivityItem[];
  initialCount?: number;
}

const ICONS = {
  price_drop: DollarSign,
  wishlisted: Heart,
  played: Gamepad2,
} as const;

const ICON_COLORS = {
  price_drop: 'text-teal',
  wishlisted: 'text-pink-400',
  played: 'text-primary',
} as const;

function formatRelativeDate(dateStr: string): string {
  // Normalize to UTC date-only to avoid timezone mismatches between
  // ISO dates ("2026-03-30") and datetimes ("2026-03-30 15:00:00")
  const datePart = dateStr.slice(0, 10);
  const date = new Date(datePart + 'T00:00:00Z');
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = todayUtc.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function RecentActivityFeed({ items, initialCount = 5 }: RecentActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No recent activity
      </div>
    );
  }

  const hasMore = items.length > initialCount;
  const visible = expanded ? items : items.slice(0, initialCount);

  return (
    <div className="space-y-1">
      {visible.map((item, i) => {
        const Icon = ICONS[item.type];
        return (
          <Link
            key={`${item.type}-${item.gameId}-${i}`}
            href={`/games/${item.gameId}`}
            className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-surface-high transition-colors group"
          >
            <Icon className={`h-4 w-4 shrink-0 ${ICON_COLORS[item.type]}`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium truncate block group-hover:text-primary transition-colors">
                {item.title}
              </span>
              <span className="text-xs text-muted-foreground">{item.detail}</span>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelativeDate(item.date)}
            </span>
          </Link>
        );
      })}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors pt-1 w-full justify-center"
        >
          {expanded ? (
            <>Show less <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Show {items.length - initialCount} more <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  );
}
