/**
 * Application configuration loaded from environment variables.
 * Provides type-safe access to all config values.
 */

export interface AppConfig {
  // Database
  databaseUrl: string;

  // Steam
  steamApiKey: string;
  steamUserId: string;

  // IsThereAnyDeal
  itadApiKey: string;

  // Discord
  discordWebhookUrl: string;

  // App
  appUrl: string;

  // Cron schedules
  cronPriceCheck: string;
  cronLibrarySync: string;
}

let config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!config) {
    config = {
      databaseUrl: process.env.DATABASE_URL || './data/hoard.db',
      steamApiKey: process.env.STEAM_API_KEY || '',
      steamUserId: process.env.STEAM_USER_ID || '',
      itadApiKey: process.env.ITAD_API_KEY || '',
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      cronPriceCheck: process.env.CRON_PRICE_CHECK || '0 */12 * * *',
      cronLibrarySync: process.env.CRON_LIBRARY_SYNC || '0 3 * * *',
    };
  }
  return config;
}

/**
 * Validate that required config values are present.
 * Call this at app startup.
 */
export function validateConfig(): { valid: boolean; missing: string[] } {
  const cfg = getConfig();
  const missing: string[] = [];

  if (!cfg.steamApiKey) missing.push('STEAM_API_KEY');
  if (!cfg.steamUserId) missing.push('STEAM_USER_ID');

  return { valid: missing.length === 0, missing };
}
