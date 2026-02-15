import { redirect } from 'next/navigation';
import { getAlertStats } from '@/lib/db/queries';
import { getEffectiveConfig } from '@/lib/config';
import { getSession } from '@/lib/auth-helpers';
import { AlertConfig } from '@/components/settings/AlertConfig';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let alertThrottleHours = 24;
  let alertStats = { activeCount: 0, recentlyTriggered: 0 };
  try {
    const cfg = getEffectiveConfig();
    alertThrottleHours = cfg.alertThrottleHours;
    alertStats = getAlertStats(session.user.id);
  } catch {
    // DB not initialized yet — render with defaults
  }

  return (
    <AlertConfig
      initialThrottleHours={alertThrottleHours}
      activeAlertCount={alertStats.activeCount}
    />
  );
}
