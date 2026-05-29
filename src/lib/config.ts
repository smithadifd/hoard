/**
 * Application configuration loaded from environment variables.
 * Provides type-safe access to all config values.
 */

import { getAllSettings, getNotificationPreferences } from './db/queries';

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
  discordOpsWebhookUrl: string;

  // App
  appUrl: string;

  // Cron schedules
  cronPriceCheck: string;
  cronLibrarySync: string;
  cronWishlistSync: string;
  cronHltbSync: string;
  cronReviewSync: string;
  cronPriceHistoryBackfill: string;
  cronMetadataRefresh: string;

  // Alerts
  alertThrottleHours: number;

  // Backups
  cronBackup: string;
  backupRetentionDays: number;
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
      discordOpsWebhookUrl: process.env.DISCORD_OPS_WEBHOOK_URL || '',
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://hoard.home',
      cronPriceCheck: process.env.CRON_PRICE_CHECK || '0 */12 * * *',
      cronLibrarySync: process.env.CRON_LIBRARY_SYNC || '0 3 * * *',
      cronWishlistSync: process.env.CRON_WISHLIST_SYNC || '0 1 * * *',
      cronHltbSync: process.env.CRON_HLTB_SYNC || '0 2 * * 0,3',
      // Weekly — metadata_refresh now handles wishlisted/owned daily; reviews.ts
      // retains unique coverage for lookup-sourced rows (Global Search) and
      // watchlist-only games that the metadata drain never visits.
      cronReviewSync: process.env.CRON_REVIEW_SYNC || '0 4 * * 0',
      cronPriceHistoryBackfill: process.env.CRON_PRICE_HISTORY_BACKFILL || '0 5 * * *',
      cronMetadataRefresh: process.env.CRON_METADATA_REFRESH || '0 6 * * *',
      alertThrottleHours: parseInt(process.env.ALERT_THROTTLE_HOURS || '24', 10),
      cronBackup: process.env.CRON_BACKUP || '0 4 * * *',
      backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10),
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
    discordOpsWebhookUrl: dbSettings['discord_ops_webhook_url'] || envConfig.discordOpsWebhookUrl,
    // Throttle now lives in notification_preferences. getNotificationPreferences()
    // owns the full precedence (new blob → legacy alert_throttle_hours setting →
    // ALERT_THROTTLE_HOURS env → 24), so this is the single source of truth shared
    // with the settings UI.
    alertThrottleHours: getNotificationPreferences().frequency.throttleHours,
  };
}
