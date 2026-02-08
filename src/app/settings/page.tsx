import { getAllSettings, getScoringConfig, getAlertStats } from '@/lib/db/queries';
import { getEffectiveConfig } from '@/lib/config';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { ScoringConfig } from '@/components/settings/ScoringConfig';
import { AlertConfig } from '@/components/settings/AlertConfig';

export const dynamic = 'force-dynamic';

/**
 * Settings Page - Configure API keys, scoring preferences, and trigger syncs.
 * Server Component loads current settings, passes to client forms.
 */
export default function SettingsPage() {
  let initialSettings: Record<string, string> = {};
  let scoringConfig = getScoringConfig();
  let alertStats = { activeCount: 0, recentlyTriggered: 0 };
  let alertThrottleHours = 24;

  try {
    initialSettings = getAllSettings();
    scoringConfig = getScoringConfig();
    alertStats = getAlertStats();
    const cfg = getEffectiveConfig();
    alertThrottleHours = cfg.alertThrottleHours;
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

      <AlertConfig
        initialThrottleHours={alertThrottleHours}
        activeAlertCount={alertStats.activeCount}
      />
    </div>
  );
}
