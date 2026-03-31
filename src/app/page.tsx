import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Library, Heart, Bell, Gamepad2, RefreshCw, DollarSign, BookOpen, CalendarClock, Tags, BarChart3, Activity } from 'lucide-react';
import { getDashboardStats, getRecentSyncLogs, getDealsCount, getBacklogStats, getAlertStats, getUnreleasedWishlistGames, getGenreDistribution, getDealScoreDistribution, getRecentActivity } from '@/lib/db/queries';
import { parseReleaseDate, getReleaseBucket } from '@/lib/utils/releaseDate';
import { getSession } from '@/lib/auth-helpers';
import GenreChart from '@/components/dashboard/GenreChart';
import DealScoreChart from '@/components/dashboard/DealScoreChart';
import RecentActivityFeed from '@/components/dashboard/RecentActivityFeed';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  let stats = { libraryCount: 0, wishlistCount: 0, watchlistCount: 0, totalPlaytimeHours: 0 };
  let dealsActive = 0;
  let backlogStats = { unplayedCount: 0, totalOwned: 0 };
  let alertStats = { activeCount: 0, recentlyTriggered: 0 };
  let lastSyncLabel = 'Never';
  let upcomingReleases: Array<{ title: string; releaseLabel: string; id: number }> = [];
  let genreData: Array<{ name: string; count: number }> = [];
  let dealScoreData: Array<{ bucket: string; count: number }> = [];
  let recentActivity: Array<{ type: 'price_drop' | 'wishlisted' | 'played'; gameId: number; title: string; detail: string; date: string }> = [];

  try {
    stats = getDashboardStats(session.user.id);
    dealsActive = getDealsCount();
    backlogStats = getBacklogStats(session.user.id);
    alertStats = getAlertStats(session.user.id);
    genreData = getGenreDistribution(session.user.id);
    dealScoreData = getDealScoreDistribution(session.user.id);
    recentActivity = getRecentActivity(session.user.id);

    // Get upcoming releases for the dashboard card
    const unreleasedGames = getUnreleasedWishlistGames(session.user.id);
    const now = new Date();
    upcomingReleases = unreleasedGames
      .map((g) => {
        const parsed = parseReleaseDate(g.releaseDate);
        const bucket = getReleaseBucket(parsed, now);
        return { title: g.title, releaseLabel: parsed.label, id: g.id, bucket, date: parsed.date };
      })
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-headline font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Your game collection at a glance
        </p>
      </div>

      {/* Compact Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <CompactStat href="/library" icon={<Library className="h-4 w-4" />} label="Library" value={stats.libraryCount > 0 ? stats.libraryCount.toLocaleString() : '—'} />
        <CompactStat href="/wishlist" icon={<Heart className="h-4 w-4" />} label="Wishlist" value={stats.wishlistCount > 0 ? stats.wishlistCount.toLocaleString() : '—'} />
        <CompactStat href="/watchlist" icon={<Bell className="h-4 w-4" />} label="Alerts" value={alertStats.activeCount > 0 ? alertStats.activeCount.toLocaleString() : '—'} />
        <CompactStat href="/library" icon={<Gamepad2 className="h-4 w-4" />} label="Playtime" value={stats.totalPlaytimeHours > 0 ? `${stats.totalPlaytimeHours.toLocaleString()}h` : '—'} />
        <CompactStat href="/wishlist?onSale=true" icon={<DollarSign className="h-4 w-4" />} label="On Sale" value={dealsActive > 0 ? dealsActive.toLocaleString() : '—'} />
        <CompactStat href="/backlog" icon={<BookOpen className="h-4 w-4" />} label="Backlog" value={backlogStats.unplayedCount > 0 ? backlogStats.unplayedCount.toLocaleString() : '—'} />
      </div>

      {/* Setup Prompt */}
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
        <>
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DashboardCard icon={<Tags className="h-4 w-4" />} title="Genre Breakdown">
              <GenreChart data={genreData} />
            </DashboardCard>
            <DashboardCard icon={<BarChart3 className="h-4 w-4" />} title="Deal Score Distribution">
              <DealScoreChart data={dealScoreData} />
            </DashboardCard>
          </div>

          {/* Activity + Upcoming Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DashboardCard icon={<Activity className="h-4 w-4" />} title="Recent Activity">
              <RecentActivityFeed items={recentActivity} />
            </DashboardCard>

            {upcomingReleases.length > 0 && (
              <DashboardCard
                icon={<CalendarClock className="h-4 w-4" />}
                title="Upcoming Releases"
                action={<Link href="/releases" className="text-xs text-primary hover:underline">View all</Link>}
              >
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
              </DashboardCard>
            )}
          </div>

          {/* Footer Bar */}
          <div className="rounded-xl bg-card/60 border border-white/[0.04] px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 mr-auto">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">Last Synced</span>
              <span className="text-sm font-medium">{lastSyncLabel}</span>
            </div>
            <QuickLink href="/library" icon={<Library className="h-3.5 w-3.5" />} label="Library" />
            <QuickLink href="/wishlist" icon={<Heart className="h-3.5 w-3.5" />} label="Wishlist" />
            <QuickLink href="/backlog" icon={<BookOpen className="h-3.5 w-3.5" />} label="Backlog" />
            <QuickLink href="/watchlist" icon={<Bell className="h-3.5 w-3.5" />} label="Watchlist" />
          </div>
        </>
      )}
    </div>
  );
}

function CompactStat({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <Link href={href} className="rounded-xl bg-card p-3.5 hover:bg-surface-high transition-colors group">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground group-hover:text-primary transition-colors">{icon}</span>
        <span className="text-[10px] font-label font-semibold uppercase tracking-[0.15em] text-primary">{label}</span>
      </div>
      <div className="text-xl font-headline font-extrabold">{value}</div>
    </Link>
  );
}

function DashboardCard({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-xs font-label font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
