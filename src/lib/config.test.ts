import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptSecret } from './settings/secrets';

// Must use dynamic imports to reset module-level cache between tests
async function loadConfig() {
  vi.resetModules();
  // Mock the DB queries module to avoid requiring a real database
  vi.doMock('./db/queries', () => ({
    getAllSettings: vi.fn(() => ({})),
  }));
  return import('./config');
}

// Variant that lets a test inject the DB-settings map getEffectiveConfig reads.
async function loadConfigWithSettings(settings: Record<string, string>) {
  vi.resetModules();
  vi.doMock('./db/queries', () => ({
    getAllSettings: vi.fn(() => settings),
    getNotificationPreferences: vi.fn(() => ({ frequency: { throttleHours: 24, digestHour: 12 } })),
  }));
  return import('./config');
}

describe('getConfig', () => {
  beforeEach(() => {
    // Clean env vars before each test
    delete process.env.DATABASE_URL;
    delete process.env.STEAM_API_KEY;
    delete process.env.STEAM_USER_ID;
    delete process.env.ITAD_API_KEY;
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.CRON_PRICE_CHECK;
    delete process.env.CRON_LIBRARY_SYNC;
    delete process.env.CRON_HLTB_SYNC;
    delete process.env.CRON_REVIEW_SYNC;
    delete process.env.ALERT_THROTTLE_HOURS;
    delete process.env.ATL_DIGEST_HOUR;
    delete process.env.CRON_BACKUP;
    delete process.env.BACKUP_RETENTION_DAYS;
  });

  it('returns defaults when no env vars set', async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.databaseUrl).toBe('./data/hoard.db');
    expect(config.steamApiKey).toBe('');
    expect(config.steamUserId).toBe('');
    expect(config.itadApiKey).toBe('');
    expect(config.discordWebhookUrl).toBe('');
    expect(config.appUrl).toBe('https://hoard.home');
    expect(config.alertThrottleHours).toBe(24);
    expect(config.atlDigestHour).toBe(12);
    expect(config.backupRetentionDays).toBe(30);
  });

  it('reads API keys from environment variables', async () => {
    process.env.STEAM_API_KEY = 'test-steam-key';
    process.env.STEAM_USER_ID = '76561198000000000';
    process.env.ITAD_API_KEY = 'test-itad-key';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.steamApiKey).toBe('test-steam-key');
    expect(config.steamUserId).toBe('76561198000000000');
    expect(config.itadApiKey).toBe('test-itad-key');
  });

  it('uses correct default cron schedules', async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.cronPriceCheck).toBe('0 */12 * * *');
    expect(config.cronLibrarySync).toBe('0 3 * * *');
    expect(config.cronHltbSync).toBe('0 2 * * 0,3');
    expect(config.cronReviewSync).toBe('0 4 * * 0');
    expect(config.cronBackup).toBe('0 4 * * *');
  });

  it('reads custom cron schedules from env', async () => {
    process.env.CRON_PRICE_CHECK = '0 */6 * * *';
    process.env.CRON_LIBRARY_SYNC = '0 1 * * *';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.cronPriceCheck).toBe('0 */6 * * *');
    expect(config.cronLibrarySync).toBe('0 1 * * *');
  });

  it('parses numeric env vars', async () => {
    process.env.ALERT_THROTTLE_HOURS = '48';
    process.env.BACKUP_RETENTION_DAYS = '7';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.alertThrottleHours).toBe(48);
    expect(config.backupRetentionDays).toBe(7);
  });

  it('reads a custom ATL digest hour from env', async () => {
    process.env.ATL_DIGEST_HOUR = '0';

    const { getConfig } = await loadConfig();
    const config = getConfig();

    expect(config.atlDigestHour).toBe(0);
  });

  it('falls back to the default ATL digest hour on out-of-range or invalid input', async () => {
    for (const bad of ['24', '-1', 'abc']) {
      process.env.ATL_DIGEST_HOUR = bad;
      const { getConfig } = await loadConfig();
      expect(getConfig().atlDigestHour).toBe(12);
    }
  });
});

describe('validateConfig', () => {
  beforeEach(() => {
    delete process.env.STEAM_API_KEY;
    delete process.env.STEAM_USER_ID;
  });

  it('returns valid when required keys are present', async () => {
    process.env.STEAM_API_KEY = 'test-key';
    process.env.STEAM_USER_ID = '76561198000000000';

    const { validateConfig } = await loadConfig();
    const result = validateConfig();

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('returns invalid with missing Steam API key', async () => {
    process.env.STEAM_USER_ID = '76561198000000000';

    const { validateConfig } = await loadConfig();
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('STEAM_API_KEY');
  });

  it('returns invalid with missing Steam user ID', async () => {
    process.env.STEAM_API_KEY = 'test-key';

    const { validateConfig } = await loadConfig();
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('STEAM_USER_ID');
  });

  it('returns all missing field names', async () => {
    const { validateConfig } = await loadConfig();
    const result = validateConfig();

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('STEAM_API_KEY');
    expect(result.missing).toContain('STEAM_USER_ID');
    expect(result.missing).toHaveLength(2);
  });
});

describe('getEffectiveConfig — undecryptable secret fails closed to the env-var fallback', () => {
  beforeEach(() => {
    delete process.env.STEAM_API_KEY;
    delete process.env.HOARD_SECRETS_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('an undecryptable stored secret decrypts to "" so the env var wins (never the ciphertext)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No HOARD_SECRETS_KEY set → the real decryptSecret fails closed to '' for an
    // enc:v1: value (the disaster-recovery scenario: key lost/rotated/corrupt).
    const dbSettings = {
      steam_api_key: decryptSecret('enc:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='),
    };
    expect(dbSettings.steam_api_key).toBe(''); // real helper produced the absent value

    process.env.STEAM_API_KEY = 'ENV-FALLBACK-STEAM-KEY';
    const { getEffectiveConfig } = await loadConfigWithSettings(dbSettings);
    const cfg = getEffectiveConfig();

    // config.ts merge is `dbSettings[key] || envConfig.x` — '' is falsy, so the
    // env var wins. Had decrypt returned the raw ciphertext, it would have won here.
    expect(cfg.steamApiKey).toBe('ENV-FALLBACK-STEAM-KEY');
    expect(cfg.steamApiKey).not.toContain('enc:v1:');
    warn.mockRestore();
  });
});
