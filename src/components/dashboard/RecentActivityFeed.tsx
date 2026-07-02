'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingDown, Heart, Gamepad2, ChevronDown, ChevronUp } from 'lucide-react';

type ActivityType = 'wishlisted' | 'played' | 'new_atl';

interface ActivityItem {
  type: ActivityType;
  gameId: number;
  title: string;
  detail: string;
  date: string;
}

interface RecentActivityFeedProps {
  wishlisted: ActivityItem[];
  played: ActivityItem[];
  newAtls: ActivityItem[];
  initialCount?: number;
}

type TabKey = 'wishlisted' | 'played' | 'atls';

const TAB_STORAGE_KEY = 'hoard-activity-tab';

const ICONS = {
  wishlisted: Heart,
  played: Gamepad2,
  new_atl: TrendingDown,
} as const;

const ICON_COLORS = {
  wishlisted: 'text-pink-400',
  played: 'text-primary',
  new_atl: 'text-teal',
} as const;

function formatRelativeDate(dateStr: string): string {
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

function ActivityList({
  items,
  initialCount,
  emptyLabel,
}: {
  items: ActivityItem[];
  initialCount: number;
  emptyLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        {emptyLabel}
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

const VALID_TABS: readonly TabKey[] = ['wishlisted', 'played', 'atls'];

export default function RecentActivityFeed({
  wishlisted,
  played,
  newAtls,
  initialCount = 5,
}: RecentActivityFeedProps) {
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'wishlisted';
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY) as TabKey | null;
    return stored && VALID_TABS.includes(stored) ? stored : 'wishlisted';
  });

  const selectTab = (next: TabKey) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(TAB_STORAGE_KEY, next);
    }
  };

  return (
    <div>
      <div className="flex gap-1 mb-3 -mt-1">
        <TabButton active={tab === 'wishlisted'} onClick={() => selectTab('wishlisted')}>
          New Wishlisted
        </TabButton>
        <TabButton active={tab === 'played'} onClick={() => selectTab('played')}>
          Played
        </TabButton>
        <TabButton active={tab === 'atls'} onClick={() => selectTab('atls')}>
          New ATLs
        </TabButton>
      </div>

      {tab === 'wishlisted' && (
        <ActivityList items={wishlisted} initialCount={initialCount} emptyLabel="No recently wishlisted games" />
      )}
      {tab === 'played' && (
        <ActivityList items={played} initialCount={initialCount} emptyLabel="No recently played games" />
      )}
      {tab === 'atls' && (
        <ActivityList items={newAtls} initialCount={initialCount} emptyLabel="No new all-time lows in the last 14 days" />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-surface-high'
      }`}
    >
      {children}
    </button>
  );
}
