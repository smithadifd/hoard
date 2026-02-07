import { getAllSettings } from '@/lib/db/queries';
import { SettingsForm } from '@/components/settings/SettingsForm';

/**
 * Settings Page - Configure API keys and trigger syncs.
 * Server Component loads current settings, passes to client form.
 */
export default function SettingsPage() {
  let initialSettings: Record<string, string> = {};
  try {
    initialSettings = getAllSettings();
  } catch {
    // DB not initialized yet — render with empty settings
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your API keys, scoring preferences, and sync schedule
        </p>
      </div>

      <SettingsForm initialSettings={initialSettings} />

      {/* TODO Phase 3: Scoring weights configuration */}
      {/* TODO Phase 5: Alert schedule configuration */}
    </div>
  );
}
