import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Library, Heart, Bell, Gamepad2, RefreshCw, DollarSign, Clock, BookOpen, Star, CalendarClock } from 'lucide-react';
import { getDashboardStats, getRecentSyncLogs, getDealsCount, getHltbCoverage, getReviewCoverage, getBacklogStats, getAlertStats, getUnreleasedWishlistGames } from '@/lib/db/queries';
import { parseReleaseDate, getReleaseBucket } from '@/lib/utils/releaseDate';
import { getSession } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  let stats = { libraryCount: 0, wishlistCount: 0, watchlistCount: 0, totalPlaytimeHours: 0 };
  let dealsActive = 0;
  let hltbCoverage = { withHltb: 0, total: 0 };
  let reviewCoverage = { withReviews: 0, total: 0 };
  let backlogStats = { unplayedCount: 0, totalOwned: 0 };
  let alertStats = { activeCount: 0, recentlyTriggered: 0 };
  let lastSyncLabel = 'Never';
  let upcomingReleases: Array<{ title: string; releaseLabel: string; id: number }> = [];

  try {
    stats = getDashboardStats(session.user.id);
    dealsActive = getDealsCount();
    hltbCoverage = getHltbCoverage();
    reviewCoverage = getReviewCoverage();
    backlogStats = getBacklogStats(session.user.id);
    alertStats = getAlertStats(session.user.id);

    // Get upcoming releases for the dashboard card
    const unreleasedGames = getUnreleasedWishlistGames(session.user.id);
    const now = new Date();
    upcomingReleases = unreleasedGames
      .map((g) => {
        const parsed = parseReleaseDate(g.releaseDate);
        const bucket = getReleaseBucket(parsed, now);
        return { title: g.title, releaseLabel: parsed.label, id: g.id, bucket, date: parsed.date };
      })
      // Show games with known dates first, sorted by date, then TBD
      .sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return a.title.localeCompare(b.title);
      })
      .slice(0, 5);

    const logs = getRecentSyncLogs(5);
    const lastSync = logs.find((l) => l.status === 'success' || l.status === 'partial');
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
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Dashboard</h1>
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
        <Link href="/watchlist">
          <StatCard
            icon={<Bell className="h-5 w-5" />}
            label="Watchlist"
            value={alertStats.activeCount > 0 ? alertStats.activeCount.toLocaleString() : stats.watchlistCount > 0 ? stats.watchlistCount.toLocaleString() : '—'}
            subtitle={alertStats.recentlyTriggered > 0
              ? `${alertStats.recentlyTriggered} triggered this week`
              : 'price alerts active'}
          />
        </Link>
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
          icon={<Star className="h-5 w-5" />}
          label="Review Coverage"
          value={reviewCoverage.total > 0 ? `${reviewCoverage.withReviews}/${reviewCoverage.total}` : '—'}
          subtitle={reviewCoverage.total > 0
            ? `${Math.round((reviewCoverage.withReviews / reviewCoverage.total) * 100)}% with review data`
            : 'games with review data'}
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
        <div className="rounded-xl bg-card p-6">
          <h2 className="text-lg font-headline font-bold mb-2">Welcome to Hoard</h2>
          <p className="text-muted-foreground mb-4">
            Get started by adding your Steam API key and Steam User ID in Settings,
            then sync your library.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            href="/library"
            className="rounded-xl bg-card p-4 hover:bg-surface-high transition-all group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Library className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium group-hover:text-primary transition-colors">
                Browse Library
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              View your {stats.libraryCount} owned games
            </p>
          </Link>
          <Link
            href="/wishlist"
            className="rounded-xl bg-card p-4 hover:bg-surface-high transition-all group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Heart className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium group-hover:text-primary transition-colors">
                Browse Wishlist
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Check your {stats.wishlistCount} wishlisted games
            </p>
          </Link>
          <Link
            href="/backlog"
            className="rounded-xl bg-card p-4 hover:bg-surface-high transition-all group"
          >
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium group-hover:text-primary transition-colors">
                Browse Backlog
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {backlogStats.unplayedCount} unplayed games to explore
            </p>
          </Link>
          <Link
            href="/watchlist"
            className="rounded-xl bg-card p-4 hover:bg-surface-high transition-all group"
          >
            <div className="flex items-center gap-2 mb-1">
              <Bell className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium group-hover:text-primary transition-colors">
                Manage Watchlist
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {alertStats.activeCount > 0 ? `${alertStats.activeCount} active alerts` : 'Set up price alerts'}
            </p>
          </Link>
        </div>
      )}

      {/* Upcoming Releases */}
      {upcomingReleases.length > 0 && (
        <div className="rounded-xl bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">Upcoming Releases</h2>
            </div>
            <Link href="/releases" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingReleases.map((game) => (
              <Link
                key={game.id}
                href={`/games/${game.id}`}
                className="flex items-center justify-between py-1.5 text-sm hover:text-primary transition-colors group"
              >
                <span className="truncate font-medium group-hover:text-primary">{game.title}</span>
                <span className="text-xs text-muted-foreground ml-2 shrink-0">{game.releaseLabel}</span>
              </Link>
            ))}
          </div>
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
    <div className="rounded-xl bg-card p-5 relative overflow-hidden group">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-[11px] font-label font-semibold uppercase tracking-[0.15em] text-primary">{label}</span>
      </div>
      <div className="text-2xl font-headline font-extrabold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
    </div>
  );
}
