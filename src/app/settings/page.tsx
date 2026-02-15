import { redirect } from 'next/navigation';
import { getAllSettings } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { SettingsForm } from '@/components/settings/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  let initialSettings: Record<string, string> = {};
  try {
    initialSettings = getAllSettings();
  } catch {
    // DB not initialized yet — render with defaults
  }

  return <SettingsForm initialSettings={initialSettings} />;
}
