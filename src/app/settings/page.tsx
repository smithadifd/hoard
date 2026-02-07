import { getAllSettings, getScoringConfig } from '@/lib/db/queries';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { ScoringConfig } from '@/components/settings/ScoringConfig';

/**
 * Settings Page - Configure API keys, scoring preferences, and trigger syncs.
 * Server Component loads current settings, passes to client forms.
 */
export default function SettingsPage() {
  let initialSettings: Record<string, string> = {};
  let scoringConfig = getScoringConfig();

  try {
    initialSettings = getAllSettings();
    scoringConfig = getScoringConfig();
  } catch {
    // DB not initialized yet — render with defaults
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

      <ScoringConfig
        initialWeights={scoringConfig.weights}
        initialThresholds={scoringConfig.thresholds}
      />

      {/* TODO Phase 5: Alert schedule configuration */}
    </div>
  );
}
