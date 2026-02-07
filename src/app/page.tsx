import { Library, Heart, Eye, TrendingDown, Clock, Gamepad2 } from 'lucide-react';

/**
 * Dashboard - Main landing page showing overview stats and quick actions.
 * Phase 1: Basic stats from Steam library.
 * Phase 2+: Deal alerts, price drops, recommendations.
 */
export default function DashboardPage() {
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
          value="—"
          subtitle="games owned"
        />
        <StatCard
          icon={<Heart className="h-5 w-5" />}
          label="Wishlist"
          value="—"
          subtitle="games tracked"
        />
        <StatCard
          icon={<Eye className="h-5 w-5" />}
          label="Watchlist"
          value="—"
          subtitle="price alerts active"
        />
        <StatCard
          icon={<TrendingDown className="h-5 w-5" />}
          label="Deals"
          value="—"
          subtitle="at or near ATL"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Backlog"
          value="—"
          subtitle="hours of unplayed games"
        />
        <StatCard
          icon={<Gamepad2 className="h-5 w-5" />}
          label="Last Synced"
          value="—"
          subtitle="waiting for setup"
        />
      </div>

      {/* Setup Prompt */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-2">Welcome to Hoard</h2>
        <p className="text-muted-foreground mb-4">
          Get started by adding your Steam API key and Steam User ID in Settings,
          then sync your library.
        </p>
        <a
          href="/settings"
          className="inline-flex items-center px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors"
        >
          Go to Settings
        </a>
      </div>
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
