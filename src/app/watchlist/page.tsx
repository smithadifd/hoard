import Link from 'next/link';
import { Bell, ArrowLeft } from 'lucide-react';
import { getAllPriceAlertsWithGames, getAlertStats } from '@/lib/db/queries';
import { WatchlistTable } from '@/components/alerts/WatchlistTable';

export const dynamic = 'force-dynamic';

export default function WatchlistPage() {
  let alerts: ReturnType<typeof getAllPriceAlertsWithGames> = [];
  let stats = { activeCount: 0, recentlyTriggered: 0 };

  try {
    alerts = getAllPriceAlertsWithGames();
    stats = getAlertStats();
  } catch {
    // DB not initialized yet
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Watchlist</h1>
          <p className="text-muted-foreground mt-1">
            Manage price alerts for your watchlisted games
          </p>
        </div>
        <Link
          href="/library"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Browse Library
        </Link>
      </div>

      {/* Stats */}
      {alerts.length > 0 && (
        <div className="flex gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border">
            <Bell className="h-4 w-4 text-steam-blue" />
            <span className="text-sm">
              <span className="font-medium">{stats.activeCount}</span>
              <span className="text-muted-foreground"> active alerts</span>
            </span>
          </div>
          {stats.recentlyTriggered > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-card border border-border">
              <Bell className="h-4 w-4 text-deal-great" />
              <span className="text-sm">
                <span className="font-medium">{stats.recentlyTriggered}</span>
                <span className="text-muted-foreground"> triggered this week</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Alert Table */}
      <WatchlistTable alerts={alerts} />
    </div>
  );
}
