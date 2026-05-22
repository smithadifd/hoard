import { redirect } from 'next/navigation';
import { getAlertStats, getSetting } from '@/lib/db/queries';
import { getEffectiveConfig } from '@/lib/config';
import { getSession } from '@/lib/auth-helpers';
import { AlertConfig } from '@/components/settings/AlertConfig';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let alertThrottleHours = 24;
  let alertStats = { activeCount: 0, recentlyTriggered: 0 };
  let autoAtlDealAlerts = true;
  let minSnapshots = 3;
  try {
    const cfg = getEffectiveConfig();
    alertThrottleHours = cfg.alertThrottleHours;
    alertStats = getAlertStats(session.user.id);
    const autoAtlSetting = getSetting('auto_atl_deal_alerts');
    autoAtlDealAlerts = autoAtlSetting !== 'false';
    const minSnapshotsRaw = getSetting('min_snapshots_for_atl_alert');
    const parsed = Number(minSnapshotsRaw ?? '3');
    if (Number.isFinite(parsed) && parsed >= 1) minSnapshots = Math.floor(parsed);
  } catch {
    // DB not initialized yet — render with defaults
  }

  return (
    <AlertConfig
      initialThrottleHours={alertThrottleHours}
      activeAlertCount={alertStats.activeCount}
      initialAutoAtlDealAlerts={autoAtlDealAlerts}
      initialMinSnapshots={minSnapshots}
    />
  );
}
