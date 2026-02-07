/**
 * Settings Page - Configure API keys, scoring weights, and preferences.
 *
 * Sections:
 * - API Configuration (Steam key, Steam ID, ITAD key)
 * - Discord webhook setup
 * - Scoring weights and thresholds
 * - Sync schedule configuration
 * - Manual sync triggers
 */
export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your API keys, scoring preferences, and sync schedule
        </p>
      </div>

      {/* API Keys Section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">API Configuration</h2>
        <p className="text-sm text-muted-foreground">
          API keys are stored locally in your database and never shared.
        </p>

        <div className="space-y-3">
          <FormField
            label="Steam API Key"
            placeholder="Your Steam Web API key"
            helpText="Get one at steamcommunity.com/dev/apikey"
          />
          <FormField
            label="Steam User ID"
            placeholder="Your Steam64 ID (e.g., 76561198...)"
            helpText="Find yours at steamid.io"
          />
          <FormField
            label="IsThereAnyDeal API Key"
            placeholder="Your ITAD API key"
            helpText="Register at isthereanydeal.com/dev/app/"
          />
          <FormField
            label="Discord Webhook URL"
            placeholder="https://discord.com/api/webhooks/..."
            helpText="Optional — for price alert notifications"
          />
        </div>
      </section>

      {/* Sync Section */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Data Sync</h2>
        <div className="flex gap-3">
          <button className="px-4 py-2 rounded-md bg-steam-blue text-white text-sm font-medium hover:bg-steam-blue/90 transition-colors">
            Sync Library
          </button>
          <button className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
            Sync Wishlist
          </button>
          <button className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
            Refresh Prices
          </button>
          <button className="px-4 py-2 rounded-md bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
            Backfill HLTB
          </button>
        </div>
      </section>

      {/* TODO Phase 3: Scoring weights configuration */}
      {/* TODO Phase 5: Alert schedule configuration */}
    </div>
  );
}

function FormField({
  label,
  placeholder,
  helpText,
}: {
  label: string;
  placeholder: string;
  helpText?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md bg-background border border-input text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}
