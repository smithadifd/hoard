import { redirect } from 'next/navigation';
import { getNotificationPreferences } from '@/lib/db/queries';
import { getEffectiveConfig } from '@/lib/config';
import { getSession } from '@/lib/auth-helpers';
import { NotificationConfig } from '@/components/settings/NotificationConfig';
import { DEFAULT_PREFERENCES } from '@/lib/notifications/preferences';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let preferences = DEFAULT_PREFERENCES;
  let discordConfigured = false;
  try {
    preferences = getNotificationPreferences();
    const cfg = getEffectiveConfig();
    discordConfigured = Boolean(cfg.discordWebhookUrl || cfg.discordOpsWebhookUrl);
  } catch {
    // DB not initialized yet — render with defaults
  }

  // Quiet hours are evaluated in the server's local time (Node honors the TZ env
  // var). Surface it so the user knows what reference the hours are in.
  const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <NotificationConfig
      initialPreferences={preferences}
      discordConfigured={discordConfigured}
      serverTimeZone={serverTimeZone}
    />
  );
}
