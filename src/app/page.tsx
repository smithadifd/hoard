import Link from 'next/link';
import { Library, Heart, Eye, Gamepad2, RefreshCw, DollarSign, Clock, BookOpen } from 'lucide-react';
import { getDashboardStats, getRecentSyncLogs, getDealsCount, getHltbCoverage, getBacklogStats } from '@/lib/db/queries';

export default function DashboardPage() {
  let stats = { libraryCount: 0, wishlistCount: 0, watchlistCount: 0, totalPlaytimeHours: 0 };
  let dealsActive = 0;
  let hltbCoverage = { withHltb: 0, total: 0 };
  let backlogStats = { unplayedCount: 0, totalOwned: 0 };
  let lastSyncLabel = 'Never';

  try {
    stats = getDashboardStats();
    dealsActive = getDealsCount();
    hltbCoverage = getHltbCoverage();
    backlogStats = getBacklogStats();
    const logs = getRecentSyncLogs(5);
    const lastSync = logs.find((l) => l.status === 'success');
    if (lastSync?.completedAt) {
      lastSyncLabel = new Date(lastSync.completedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  } catch {
    // DB not initialized yet
  }

  const hasData = stats.libraryCount > 0 || stats.wishlistCount > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Your game collection at a glance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={<Library className="h-5 w-5" />}
          label="Library"
          value={stats.libraryCount > 0 ? stats.libraryCount.toLocaleString() : '—'}
          subtitle="games owned"
        />
        <StatCard
          icon={<Heart className="h-5 w-5" />}
          label="Wishlist"
          value={stats.wishlistCount > 0 ? stats.wishlistCount.toLocaleString() : '—'}
          subtitle="games tracked"
        />
        <StatCard
          icon={<Eye className="h-5 w-5" />}
          label="Watchlist"
          value={stats.watchlistCount > 0 ? stats.watchlistCount.toLocaleString() : '—'}
          subtitle="price alerts active"
        />
        <StatCard
          icon={<Gamepad2 className="h-5 w-5" />}
          label="Playtime"
          value={stats.totalPlaytimeHours > 0 ? `${stats.totalPlaytimeHours.toLocaleString()}h` : '—'}
          subtitle="total hours played"
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Deals Active"
          value={dealsActive > 0 ? dealsActive.toLocaleString() : '—'}
          subtitle="games on sale"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="HLTB Coverage"
          value={hltbCoverage.total > 0 ? `${hltbCoverage.withHltb}/${hltbCoverage.total}` : '—'}
          subtitle={hltbCoverage.total > 0
            ? `${Math.round((hltbCoverage.withHltb / hltbCoverage.total) * 100)}% with duration data`
            : 'games with duration data'}
        />
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label="Backlog"
          value={backlogStats.unplayedCount > 0 ? backlogStats.unplayedCount.toLocaleString() : '—'}
          subtitle={backlogStats.totalOwned > 0
            ? `${Math.round((backlogStats.unplayedCount / backlogStats.totalOwned) * 100)}% of library unplayed`
            : 'unplayed games'}
        />
        <StatCard
          icon={<RefreshCw className="h-5 w-5" />}
          label="Last Synced"
          value={lastSyncLabel}
          subtitle={hasData ? 'sync up to date' : 'waiting for setup'}
        />
      </div>

      {/* Setup Prompt or Quick Links */}
      {!hasData ? (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-2">Welcome to Hoard</h2>
          <p className="text-muted-foreground mb-4">
            Get started by adding your Steam API key and Steam User ID in Settings,
            then sync your library.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/library"
            className="rounded-lg border border-border bg-card p-4 hover:border-steam-blue/50 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Library className="h-4 w-4 text-muted-foreground group-hover:text-steam-blue transition-colors" />
              <span className="font-medium group-hover:text-steam-blue transition-colors">
                Browse Library
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              View your {stats.libraryCount} owned games
            </p>
          </Link>
          <Link
            href="/wishlist"
            className="rounded-lg border border-border bg-card p-4 hover:border-steam-blue/50 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Heart className="h-4 w-4 text-muted-foreground group-hover:text-steam-blue transition-colors" />
              <span className="font-medium group-hover:text-steam-blue transition-colors">
                Browse Wishlist
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Check your {stats.wishlistCount} wishlisted games
            </p>
          </Link>
          <Link
            href="/backlog"
            className="rounded-lg border border-border bg-card p-4 hover:border-steam-blue/50 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="h-4 w-4 text-muted-foreground group-hover:text-steam-blue transition-colors" />
              <span className="font-medium group-hover:text-steam-blue transition-colors">
                Browse Backlog
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {backlogStats.unplayedCount} unplayed games to explore
            </p>
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
    </div>
  );
}
