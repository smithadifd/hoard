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
  // Local hour (server timezone, 0-23) at/after which the once-daily "still at ATL"
  // digest is allowed to send. The first price-check run on/after this hour each day
  // sends the digest; later runs that day are deduped. New-ATL individual alerts are
  // unaffected. Sourced from notification preferences (Settings → Notifications),
  // falling back to the ATL_DIGEST_HOUR env var, then the default.
  atlDigestHour: number;

  // Backups
  cronBackup: string;
  backupRetentionDays: number;
}

let config: AppConfig | null = null;

/** Coerce an env-provided hour to a valid 0-23 integer, falling back on bad input. */
function clampHour(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 23) return fallback;
  return Math.floor(value);
}

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
      atlDigestHour: clampHour(parseInt(process.env.ATL_DIGEST_HOUR || '12', 10), 12),
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

  // Frequency settings (throttle + digest hour) live in notification_preferences.
  // getNotificationPreferences() owns the full precedence (blob → legacy/env → default)
  // and is cached, so this is the single source of truth shared with the settings UI.
  const frequency = getNotificationPreferences().frequency;

  return {
    ...envConfig,
    steamApiKey: dbSettings['steam_api_key'] || envConfig.steamApiKey,
    steamUserId: dbSettings['steam_user_id'] || envConfig.steamUserId,
    itadApiKey: dbSettings['itad_api_key'] || envConfig.itadApiKey,
    discordWebhookUrl: dbSettings['discord_webhook_url'] || envConfig.discordWebhookUrl,
    discordOpsWebhookUrl: dbSettings['discord_ops_webhook_url'] || envConfig.discordOpsWebhookUrl,
    alertThrottleHours: frequency.throttleHours,
    atlDigestHour: frequency.digestHour,
  };
}
