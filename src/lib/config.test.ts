import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use dynamic imports to reset module-level cache between tests
async function loadConfig() {
  vi.resetModules();
  // Mock the DB queries module to avoid requiring a real database
  vi.doMock('./db/queries', () => ({
    getAllSettings: vi.fn(() => ({})),
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
    expect(config.cronReviewSync).toBe('0 4 * * 2,5');
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
