import { redirect } from 'next/navigation';
import { getAllSettings } from '@/lib/db/queries';
import { getSession } from '@/lib/auth-helpers';
import { SECRET_SETTING_KEYS } from '@/lib/validations';
import { SettingsForm } from '@/components/settings/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  // Strip secret values before handing settings to the client form. As a
  // 'use client' component, its props are serialized into the page HTML, so
  // passing raw API keys would embed them in the markup. The form gets a
  // boolean "configured" map instead and treats secret fields as write-only.
  const secretKeys = SECRET_SETTING_KEYS as readonly string[];
  let initialSettings: Record<string, string> = {};
  let secretsConfigured: Record<string, boolean> = Object.fromEntries(
    SECRET_SETTING_KEYS.map((key) => [key, false]),
  );
  try {
    const all = getAllSettings();
    initialSettings = Object.fromEntries(
      Object.entries(all).filter(([key]) => !secretKeys.includes(key)),
    );
    secretsConfigured = Object.fromEntries(
      SECRET_SETTING_KEYS.map((key) => [key, Boolean(all[key])]),
    );
  } catch {
    // DB not initialized yet — render with defaults (secrets all unconfigured)
  }

  return <SettingsForm initialSettings={initialSettings} secretsConfigured={secretsConfigured} />;
}
