/**
 * Application configuration loaded from environment variables.
 * Provides type-safe access to all config values.
 */

import { getAllSettings } from './db/queries';

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
  cronHltbSync: string;

  // Alerts
  alertThrottleHours: number;
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
      cronHltbSync: process.env.CRON_HLTB_SYNC || '0 2 * * 0',
      alertThrottleHours: parseInt(process.env.ALERT_THROTTLE_HOURS || '24', 10),
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

/**
 * Get effective config by merging DB settings over environment variables.
 * DB settings take priority, then env vars, then defaults.
 */
export function getEffectiveConfig(): AppConfig {
  const envConfig = getConfig();

  let dbSettings: Record<string, string> = {};
  try {
    dbSettings = getAllSettings();
  } catch {
    // DB may not be initialized yet — fall back to env config
  }

  return {
    ...envConfig,
    steamApiKey: dbSettings['steam_api_key'] || envConfig.steamApiKey,
    steamUserId: dbSettings['steam_user_id'] || envConfig.steamUserId,
    itadApiKey: dbSettings['itad_api_key'] || envConfig.itadApiKey,
    discordWebhookUrl: dbSettings['discord_webhook_url'] || envConfig.discordWebhookUrl,
    alertThrottleHours: dbSettings['alert_throttle_hours']
      ? parseInt(dbSettings['alert_throttle_hours'], 10)
      : envConfig.alertThrottleHours,
  };
}
