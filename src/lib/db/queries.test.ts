import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import { createTestDb, seedGame, seedUserGame, seedPriceSnapshot, seedPriceAlert, seedSetting, seedUser } from './test-helpers';
import type { TestDb } from './test-helpers';
import { SECRET_SETTING_KEYS } from '@/lib/validations';
import { __resetSecretsCryptoStateForTests } from '@/lib/settings/secrets';
import { calculateValueReceived } from '../scoring/valueReceived';
import { getEffectivePlaytimeHours } from '../scoring/engine';

// Mock getDb to return our test database
let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

// Import queries AFTER the mock is set up
import {
  getSetting,
  setSetting,
  getAllSettings,
  getScoringConfig,
  getNotificationPreferences,
  upsertGameFromSteam,
  getExistingGamesByAppIds,
  upsertUserGame,
  updateUserGame,
  capturePricePaidSuggestions,
  upsertTags,
  getEnrichedGames,
  getEnrichedGameById,
  getDashboardStats,
  getValueReceivedOverview,
  createSyncLog,
  completeSyncLog,
  getRecentSyncLogs,
  insertPriceSnapshot,
  getLatestPriceSnapshots,
  getPriceHistory,
  getDealsCount,
  upsertPriceAlert,
  getPriceAlertForGame,
  getActivePriceAlerts,
  getAllPriceAlertsWithGames,
  updatePriceAlert,
  deletePriceAlert,
  updateAlertLastNotified,
  getAlertStats,
  getAllGenres,
  getBacklogStats,
  countGames,
  getBacklogThreshold,
  getPlayAgainCompletionPct,
  getPlayAgainDormantMonths,
  getGamesForPriceSync,
  getGamesByIdsForPriceFetch,
  countOwnedGames,
  getRecentSyncStats,
  getLastSuccessfulSyncBySource,
  getFirstUserId,
  getUnreleasedCount,
  markGameAsReleased,
  updateReleaseStatus,
  getGamesForMetadataRefresh,
  updateGameMetadata,
  getEarlyAccessSnapshot,
  getAutoAlertCandidates,
  cascadePurchaseCleanup,
  getPreOwnershipState,
  getGamesForTriage,
  getDealScoreDistribution,
  updateGameHltbData,
  updateGameSteamPlaytime,
  setPlaytimeSource,
  recomputeLatestSnapshotDealScore,
  recomputeAllLatestDealScores,
} from './queries';

beforeEach(() => {
  testDb = createTestDb();
});

// ============================================
// Settings
// ============================================

describe('settings', () => {
  it('roundtrips a setting value', () => {
    setSetting('test_key', 'test_value');
    expect(getSetting('test_key')).toBe('test_value');
  });

  it('returns null for missing key', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  it('overwrites existing value', () => {
    setSetting('key', 'original');
    setSetting('key', 'updated');
    expect(getSetting('key')).toBe('updated');
  });

  it('getAllSettings returns all entries', () => {
    setSetting('key1', 'value1');
    setSetting('key2', 'value2');
    const all = getAllSettings();
    expect(all).toEqual({ key1: 'value1', key2: 'value2' });
  });

  it('getAllSettings returns empty object when no settings', () => {
    expect(getAllSettings()).toEqual({});
  });
});

// ============================================
// Settings — secret encryption at rest (Queue S · S12 · MC-3)
// ============================================
describe('settings secret encryption (non-bricking)', () => {
  // Read the raw on-disk value, bypassing the decrypt in getSetting.
  function rawStored(key: string): string | undefined {
    return testDb
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get()?.value;
  }

  afterEach(() => {
    __resetSecretsCryptoStateForTests();
    delete process.env.HOARD_SECRETS_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  });

  it('with a key set: secret keys are stored as enc:v1: ciphertext but read back decrypted', () => {
    process.env.HOARD_SECRETS_KEY = 'integration-test-key';
    __resetSecretsCryptoStateForTests();

    setSetting('steam_api_key', 'MY-REAL-STEAM-KEY');

    const stored = rawStored('steam_api_key');
    expect(stored?.startsWith('enc:v1:')).toBe(true); // encrypted at rest
    expect(stored).not.toContain('MY-REAL-STEAM-KEY'); // no plaintext on disk
    expect(getSetting('steam_api_key')).toBe('MY-REAL-STEAM-KEY'); // decrypts on read
    expect(getAllSettings()['steam_api_key']).toBe('MY-REAL-STEAM-KEY');
  });

  it('reads a LEGACY PLAINTEXT secret row verbatim (pre-encryption data)', () => {
    process.env.HOARD_SECRETS_KEY = 'integration-test-key';
    __resetSecretsCryptoStateForTests();

    // Simulate an existing plaintext row written before this feature shipped.
    seedSetting(testDb, 'itad_api_key', 'legacy-plaintext-itad-key');

    expect(rawStored('itad_api_key')).toBe('legacy-plaintext-itad-key');
    expect(getSetting('itad_api_key')).toBe('legacy-plaintext-itad-key');
    expect(getAllSettings()['itad_api_key']).toBe('legacy-plaintext-itad-key');
  });

  it('NON-secret keys are never encrypted (stored verbatim)', () => {
    process.env.HOARD_SECRETS_KEY = 'integration-test-key';
    __resetSecretsCryptoStateForTests();

    setSetting('scoring_weights', '{"priceWeight":0.5}');
    expect(rawStored('scoring_weights')).toBe('{"priceWeight":0.5}');
    expect(getSetting('scoring_weights')).toBe('{"priceWeight":0.5}');
  });

  it('with NO key: secret writes degrade to plaintext (transition-safe, no crash)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.HOARD_SECRETS_KEY;
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    __resetSecretsCryptoStateForTests();

    setSetting('discord_webhook_url', 'https://discord.com/api/webhooks/1/tok');
    expect(rawStored('discord_webhook_url')).toBe('https://discord.com/api/webhooks/1/tok');
    expect(getSetting('discord_webhook_url')).toBe('https://discord.com/api/webhooks/1/tok');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('every SECRET_SETTING_KEYS entry round-trips through encryption', () => {
    process.env.HOARD_SECRETS_KEY = 'integration-test-key';
    __resetSecretsCryptoStateForTests();

    for (const key of SECRET_SETTING_KEYS) {
      const value = `secret-value-for-${key}`;
      setSetting(key, value);
      expect(rawStored(key)?.startsWith('enc:v1:')).toBe(true);
      expect(getSetting(key)).toBe(value);
    }
  });

  it('FAILS CLOSED at the helper: a WRONG-KEY secret reads back as absent (empty), not ciphertext', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Written under one key…
    process.env.HOARD_SECRETS_KEY = 'key-A';
    __resetSecretsCryptoStateForTests();
    setSetting('steam_api_key', 'REAL-STEAM-KEY');
    const ciphertext = rawStored('steam_api_key');
    expect(ciphertext?.startsWith('enc:v1:')).toBe(true);

    // …read under a different key → cannot decrypt → helper returns '' (fail-closed).
    process.env.HOARD_SECRETS_KEY = 'key-B';
    __resetSecretsCryptoStateForTests();
    expect(getSetting('steam_api_key')).toBe('');
    expect(getAllSettings()['steam_api_key']).toBe('');
    // The raw ciphertext is untouched on disk (a supervised re-key can still recover it).
    expect(rawStored('steam_api_key')).toBe(ciphertext);
    err.mockRestore();
  });
});

// ============================================
// Scoring Config
// ============================================

describe('getScoringConfig', () => {
  // The scoring config has a 60s in-memory cache keyed on Date.now().
  // To bust it between tests, we advance Date.now by >60s each time.
  let timeOffset = 0;
  const realDateNow = Date.now;

  beforeEach(() => {
    timeOffset += 61_000; // advance past TTL
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + timeOffset);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults when no DB settings exist', () => {
    const config = getScoringConfig();
    expect(config.weights.priceWeight).toBe(0.30);
    expect(config.weights.reviewWeight).toBe(0.25);
    expect(config.thresholds.maxDollarsPerHour.overwhelminglyPositive).toBe(4.00);
  });

  it('returns custom weights from DB', () => {
    seedSetting(testDb, 'scoring_weights', JSON.stringify({ priceWeight: 0.5 }));
    const config = getScoringConfig();
    expect(config.weights.priceWeight).toBe(0.5);
    // Other weights should still be defaults
    expect(config.weights.reviewWeight).toBe(0.25);
  });

  it('merges partial threshold overrides with defaults', () => {
    seedSetting(testDb, 'scoring_thresholds', JSON.stringify({
      maxDollarsPerHour: { overwhelminglyPositive: 6.0 },
    }));
    const config = getScoringConfig();
    expect(config.thresholds.maxDollarsPerHour.overwhelminglyPositive).toBe(6.0);
    expect(config.thresholds.maxDollarsPerHour.veryPositive).toBe(3.00); // default
  });
});

describe('getNotificationPreferences', () => {
  // 60s in-memory cache keyed on Date.now() — advance past TTL between tests.
  let timeOffset = 0;
  const realDateNow = Date.now;

  beforeEach(() => {
    timeOffset += 61_000;
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + timeOffset);
    // The throttle / digest-hour seeds fall back to these env vars — pin them empty
    // for determinism so the built-in defaults apply unless a test seeds a setting.
    vi.stubEnv('ALERT_THROTTLE_HOURS', '');
    vi.stubEnv('ATL_DIGEST_HOUR', '');
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns defaults when no settings exist', () => {
    const prefs = getNotificationPreferences();
    expect(prefs.frequency.throttleHours).toBe(24);
    expect(prefs.frequency.digestHour).toBe(12);
    expect(prefs.categories['deal-individual']).toEqual({ inApp: true, discord: true });
    expect(prefs.quietHours.enabled).toBe(false);
  });

  it('reads a custom digest hour from the blob', () => {
    seedSetting(testDb, 'notification_preferences', JSON.stringify({ frequency: { throttleHours: 24, digestHour: 7 } }));
    expect(getNotificationPreferences().frequency.digestHour).toBe(7);
  });

  it('seeds the digest hour from the ATL_DIGEST_HOUR env when the blob omits it', () => {
    vi.stubEnv('ATL_DIGEST_HOUR', '20');
    expect(getNotificationPreferences().frequency.digestHour).toBe(20);
  });

  it('clamps an out-of-range digest hour back to the default', () => {
    seedSetting(testDb, 'notification_preferences', JSON.stringify({ frequency: { throttleHours: 24, digestHour: 99 } }));
    expect(getNotificationPreferences().frequency.digestHour).toBe(12);
  });

  it('seeds throttle from the legacy alert_throttle_hours setting', () => {
    seedSetting(testDb, 'alert_throttle_hours', '48');
    expect(getNotificationPreferences().frequency.throttleHours).toBe(48);
  });

  it('prefers the new blob throttle over the legacy setting', () => {
    seedSetting(testDb, 'alert_throttle_hours', '48');
    seedSetting(testDb, 'notification_preferences', JSON.stringify({ frequency: { throttleHours: 6 } }));
    expect(getNotificationPreferences().frequency.throttleHours).toBe(6);
  });

  it('merges partial category routing over defaults', () => {
    seedSetting(
      testDb,
      'notification_preferences',
      JSON.stringify({ categories: { 'deal-individual': { inApp: false, discord: true } } }),
    );
    const prefs = getNotificationPreferences();
    expect(prefs.categories['deal-individual']).toEqual({ inApp: false, discord: true });
    expect(prefs.categories['milestone']).toEqual({ inApp: true, discord: true }); // untouched → default
  });

  it('reads custom quiet hours', () => {
    seedSetting(
      testDb,
      'notification_preferences',
      JSON.stringify({ quietHours: { enabled: true, start: 23, end: 7 } }),
    );
    expect(getNotificationPreferences().quietHours).toEqual({ enabled: true, start: 23, end: 7 });
  });

  it('falls back to defaults on malformed JSON', () => {
    seedSetting(testDb, 'notification_preferences', '{not valid json');
    const prefs = getNotificationPreferences();
    expect(prefs.frequency.throttleHours).toBe(24);
    expect(prefs.categories['deal-individual']).toEqual({ inApp: true, discord: true });
  });
});

// ============================================
// Game Upserts
// ============================================

describe('upsertGameFromSteam', () => {
  it('creates a new game', () => {
    const id = upsertGameFromSteam({ steamAppId: 440, title: 'Team Fortress 2' });
    expect(id).toBeGreaterThan(0);
  });

  it('updates existing game by steamAppId', () => {
    const id1 = upsertGameFromSteam({ steamAppId: 440, title: 'TF2' });
    const id2 = upsertGameFromSteam({ steamAppId: 440, title: 'Team Fortress 2' });
    expect(id2).toBe(id1);
  });

  it('returns game ID', () => {
    const id = upsertGameFromSteam({ steamAppId: 570, title: 'Dota 2' });
    expect(typeof id).toBe('number');
  });

  it('stores null header image when none is provided (no legacy URL fabrication)', () => {
    const id = upsertGameFromSteam({ steamAppId: 440, title: 'TF2' });
    const game = getEnrichedGameById(id, 'default');
    expect(game?.headerImageUrl).toBeFalsy();
  });

  it('preserves an existing header image URL on conflict-update with no new URL', () => {
    upsertGameFromSteam({
      steamAppId: 440,
      title: 'TF2',
      headerImageUrl: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/440/hash/header.jpg?t=1',
    });
    // Library sync would call this again without an image URL
    const id = upsertGameFromSteam({ steamAppId: 440, title: 'TF2' });
    const game = getEnrichedGameById(id, 'default');
    expect(game?.headerImageUrl).toContain('shared.akamai.steamstatic.com');
  });
});

describe('getExistingGamesByAppIds', () => {
  it('returns map of existing games', () => {
    seedGame(testDb, { steamAppId: 100, title: 'Game A' });
    seedGame(testDb, { steamAppId: 200, title: 'Game B' });

    const result = getExistingGamesByAppIds([100, 200, 300]);
    expect(result.size).toBe(2);
    expect(result.get(100)?.title).toBe('Game A');
    expect(result.get(200)?.title).toBe('Game B');
    expect(result.has(300)).toBe(false);
  });

  it('returns empty map for empty input', () => {
    const result = getExistingGamesByAppIds([]);
    expect(result.size).toBe(0);
  });
});

// ============================================
// User Game Operations
// ============================================

describe('upsertUserGame', () => {
  it('creates a user_game record', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    upsertUserGame(gameId, { isOwned: true, playtimeMinutes: 120 }, 'default');

    const enriched = getEnrichedGameById(gameId, 'default');
    expect(enriched?.isOwned).toBe(true);
    expect(enriched?.playtimeMinutes).toBe(120);
  });

  it('updates existing record on conflict', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    upsertUserGame(gameId, { isOwned: true, playtimeMinutes: 100 }, 'default');
    upsertUserGame(gameId, { playtimeMinutes: 200 }, 'default');

    const enriched = getEnrichedGameById(gameId, 'default');
    expect(enriched?.playtimeMinutes).toBe(200);
  });

  it('reconciles a Hoard-only entry by clearing wishlistedLocally on conflict', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    // Hoard-only wishlist entry…
    upsertUserGame(gameId, { isWishlisted: true, wishlistedLocally: true }, 'default');
    // …then it shows up on the Steam wishlist sync (mirrors syncWishlist's reconcile call).
    upsertUserGame(gameId, { isWishlisted: true, wishlistedLocally: false }, 'default');

    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.isWishlisted).toBe(true);
    expect(row?.wishlistedLocally).toBe(false);
  });

  it('captures wishlistedAt set-if-null: keeps the earliest date, never overwrites', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    // First sync records the true Steam wishlist-add date.
    upsertUserGame(gameId, { isWishlisted: true, wishlistedAt: '2023-11-14T22:13:20.000Z' }, 'default');
    // A later sync reports a different date_added — must NOT overwrite the stored value.
    upsertUserGame(gameId, { isWishlisted: true, wishlistedAt: '2025-01-01T00:00:00.000Z' }, 'default');

    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.wishlistedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('backfills wishlistedAt when the stored value is null', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    // Pre-existing row with no captured date (e.g. predates the column).
    upsertUserGame(gameId, { isWishlisted: true }, 'default');
    // Next sync supplies the date — fills the null.
    upsertUserGame(gameId, { isWishlisted: true, wishlistedAt: '2023-11-14T22:13:20.000Z' }, 'default');

    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.wishlistedAt).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('updateUserGame', () => {
  it('patches user game fields', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });

    const result = updateUserGame(gameId, { personalInterest: 5 }, 'default');
    expect(result).toBe(true);
  });

  it('returns false for non-existent game', () => {
    const result = updateUserGame(99999, { personalInterest: 5 }, 'default');
    expect(result).toBe(false);
  });

  it('creates alert when watchlisted', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });

    updateUserGame(gameId, { isWatchlisted: true }, 'default');
    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert).not.toBeNull();
    expect(alert?.isActive).toBe(true);
  });

  it('deactivates alert when unwatchlisted', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, isWatchlisted: true });
    seedPriceAlert(testDb, gameId);

    updateUserGame(gameId, { isWatchlisted: false }, 'default');
    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert?.isActive).toBe(false);
  });

  it('upserts alert when priceThreshold changes', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, isWatchlisted: true });

    updateUserGame(gameId, { priceThreshold: 9.99 }, 'default');
    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert).not.toBeNull();
    expect(alert?.targetPrice).toBe(9.99);
  });

  it('sets wishlistedLocally (Hoard-only wishlist add)', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, {});

    updateUserGame(gameId, { isWishlisted: true, wishlistedLocally: true }, 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.isWishlisted).toBe(true);
    expect(row?.wishlistedLocally).toBe(true);
  });

  it('clears wishlistedLocally when unwishlisting', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isWishlisted: true, wishlistedLocally: true });

    updateUserGame(gameId, { isWishlisted: false }, 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.isWishlisted).toBe(false);
    expect(row?.wishlistedLocally).toBe(false);
  });

  it('persists pricePaid and stamps pricePaidAt', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 600 });

    updateUserGame(gameId, { pricePaid: 19.99 }, 'default');
    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.pricePaid).toBe(19.99);
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidAt).not.toBeNull();
  });

  it('clears pricePaid and pricePaidAt when set to null', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });

    updateUserGame(gameId, { pricePaid: 30 }, 'default');
    updateUserGame(gameId, { pricePaid: null }, 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaid).toBeNull();
    expect(row?.pricePaidAt).toBeNull();
  });

  it('clears a pending suggestion when a real price is confirmed', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaidSuggested: 14.99 });

    updateUserGame(gameId, { pricePaid: 14.99 }, 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaid).toBe(14.99);
    expect(row?.pricePaidSuggested).toBeNull();
  });

  it('stamps pricePaidSuggestionDismissedAt on dismiss without writing a price', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaidSuggested: 14.99 });

    updateUserGame(gameId, { dismissPriceSuggestion: true }, 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidSuggestionDismissedAt).not.toBeNull();
    expect(row?.pricePaid).toBeNull();
    expect(row?.pricePaidSuggested).toBe(14.99); // retained, just dismissed
  });
});

// ============================================
// Tags
// ============================================

describe('upsertTags', () => {
  it('creates tags and associations', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    upsertTags(gameId, ['Action', 'FPS'], 'genre');

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.genres).toContain('Action');
    expect(game?.genres).toContain('FPS');
  });
});

// ============================================
// Enriched Game Queries
// ============================================

describe('getEnrichedGames', () => {
  beforeEach(() => {
    // Seed some games with user_games
    const game1 = seedGame(testDb, { steamAppId: 100, title: 'Alpha Game', reviewScore: 90 });
    const game2 = seedGame(testDb, { steamAppId: 200, title: 'Beta Game', reviewScore: 70 });
    const game3 = seedGame(testDb, { steamAppId: 300, title: 'Charlie Game', reviewScore: 85 });

    seedUserGame(testDb, game1, { isOwned: true, playtimeMinutes: 600 });
    seedUserGame(testDb, game2, { isOwned: true, isWishlisted: true, playtimeMinutes: 0 });
    seedUserGame(testDb, game3, { isOwned: false, isWishlisted: true, playtimeMinutes: 30 });
  });

  it('returns all games with no filters', () => {
    const result = getEnrichedGames({}, undefined, undefined, 'default');
    expect(result.games).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('filters by search term', () => {
    const result = getEnrichedGames({ search: 'Alpha' }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(1);
    expect(result.games[0].title).toBe('Alpha Game');
  });

  it('filters by owned view', () => {
    const result = getEnrichedGames({ view: 'library' }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(2);
  });

  it('filters by wishlist view', () => {
    const result = getEnrichedGames({ view: 'wishlist' }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(2);
  });

  it('paginates correctly', () => {
    const page1 = getEnrichedGames({}, 1, 2, 'default');
    expect(page1.games).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = getEnrichedGames({}, 2, 2, 'default');
    expect(page2.games).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('sorts by title ascending by default', () => {
    const result = getEnrichedGames({}, undefined, undefined, 'default');
    expect(result.games[0].title).toBe('Alpha Game');
    expect(result.games[2].title).toBe('Charlie Game');
  });

  it('sorts by title descending', () => {
    const result = getEnrichedGames({ sortBy: 'title', sortOrder: 'desc' }, undefined, undefined, 'default');
    expect(result.games[0].title).toBe('Charlie Game');
  });

  it('sorts by review score', () => {
    const result = getEnrichedGames({ sortBy: 'review', sortOrder: 'desc' }, undefined, undefined, 'default');
    expect(result.games[0].reviewScore).toBe(90);
  });
});

describe('getEnrichedGames — requireCompleteData (deal-ready gate)', () => {
  // The wishlist's default gate: a game is "deal-ready" when it has a price to
  // judge and a review to anchor quality. HLTB is optional — a priced, reviewed
  // deal must not be hidden just because HLTB has no match (it surfaces with a
  // low-confidence badge instead, driven by dataCompleteness).
  it('shows a priced + reviewed game that is missing HLTB, flagged not-full', () => {
    const id = seedGame(testDb, { steamAppId: 900, title: 'No HLTB Deal', reviewScore: 92, hltbMain: null });
    seedUserGame(testDb, id, { isWishlisted: true });
    seedPriceSnapshot(testDb, id, { priceCurrent: 9.99, discountPercent: 60 });

    const result = getEnrichedGames({ view: 'wishlist', requireCompleteData: true }, undefined, undefined, 'default');
    expect(result.games.map((g) => g.title)).toContain('No HLTB Deal');
    const game = result.games.find((g) => g.title === 'No HLTB Deal');
    expect(game?.dataCompleteness).not.toBe('full'); // drives the low-confidence badge
  });

  it('hides a wishlisted game with no price snapshot under the gate', () => {
    const id = seedGame(testDb, { steamAppId: 901, title: 'No Price', reviewScore: 88, hltbMain: 12 });
    seedUserGame(testDb, id, { isWishlisted: true });

    const result = getEnrichedGames({ view: 'wishlist', requireCompleteData: true }, undefined, undefined, 'default');
    expect(result.games.map((g) => g.title)).not.toContain('No Price');
  });

  it('hides a priced game with no review under the gate', () => {
    const id = seedGame(testDb, { steamAppId: 902, title: 'No Review', reviewScore: null, hltbMain: 12 });
    seedUserGame(testDb, id, { isWishlisted: true });
    seedPriceSnapshot(testDb, id, { priceCurrent: 19.99 });

    const result = getEnrichedGames({ view: 'wishlist', requireCompleteData: true }, undefined, undefined, 'default');
    expect(result.games.map((g) => g.title)).not.toContain('No Review');
  });
});

describe('recomputeLatestSnapshotDealScore (deal-score sort key ↔ live badge)', () => {
  it('refreshes a stale stored score to match the live badge when HLTB lands after the snapshot', () => {
    const id = seedGame(testDb, { steamAppId: 910, title: 'Late HLTB', reviewScore: 95, hltbMain: null });
    seedUserGame(testDb, id, { isWishlisted: true, personalInterest: 3 });
    // Snapshot written before HLTB matched — store a deliberately stale, value-neutral score.
    seedPriceSnapshot(testDb, id, {
      priceCurrent: 6.49, priceRegular: 9.99, historicalLowPrice: 6.49, isHistoricalLow: true, dealScore: 50,
    });

    // HLTB matches later; the wired update path recomputes the latest snapshot's stored score.
    updateGameHltbData(id, { hltbId: 123, hltbMain: 2.44 }, false);

    const live = getEnrichedGames({ view: 'wishlist' }, undefined, undefined, 'default').games.find((g) => g.id === id);
    const stored = getLatestPriceSnapshots([id]).get(id);
    expect(stored?.dealScore).toBe(live?.dealScore); // sort key now equals the badge
    expect(stored?.dealScore).not.toBe(50); // no longer the stale value
  });

  it('does nothing on an HLTB miss (HLTB unchanged → score unchanged)', () => {
    const id = seedGame(testDb, { steamAppId: 913, title: 'Miss', reviewScore: 90, hltbMain: null });
    seedUserGame(testDb, id, { isWishlisted: true });
    seedPriceSnapshot(testDb, id, { priceCurrent: 5, dealScore: 42 });

    updateGameHltbData(id, {}, true); // miss → backoff, no enrichment

    expect(getLatestPriceSnapshots([id]).get(id)?.dealScore).toBe(42);
  });

  it('recomputeAllLatestDealScores returns the count of games whose stored score changed', () => {
    const stale = seedGame(testDb, { steamAppId: 911, title: 'Stale', reviewScore: 90, hltbMain: 5 });
    seedUserGame(testDb, stale, { isWishlisted: true });
    seedPriceSnapshot(testDb, stale, {
      priceCurrent: 5, priceRegular: 10, historicalLowPrice: 5, isHistoricalLow: true, dealScore: 1,
    });

    const fresh = seedGame(testDb, { steamAppId: 912, title: 'Fresh', reviewScore: 90, hltbMain: 5 });
    seedUserGame(testDb, fresh, { isWishlisted: true });
    seedPriceSnapshot(testDb, fresh, {
      priceCurrent: 5, priceRegular: 10, historicalLowPrice: 5, isHistoricalLow: true, dealScore: 1,
    });
    recomputeLatestSnapshotDealScore(fresh); // already fresh going in

    expect(recomputeAllLatestDealScores()).toBe(1); // only the stale game changes
  });
});

describe('playtime-source toggle ($/hour basis ↔ stored deal score)', () => {
  // Price $20; HLTB 10h → $2.00/h; Steam median 40h → $0.50/h. The two bases give
  // clearly different $/hour so we can prove the toggle calculates against the
  // right value each way.
  function seedToggleGame() {
    const id = seedGame(testDb, {
      steamAppId: 920,
      title: 'Toggle Me',
      reviewScore: 90,
      hltbMain: 10,
      steamPlaytimeMedian: 40,
      steamPlaytimeSampleSize: 150,
    });
    seedUserGame(testDb, id, { isWishlisted: true, personalInterest: 3 });
    seedPriceSnapshot(testDb, id, {
      priceCurrent: 20, priceRegular: 40, historicalLowPrice: 20, isHistoricalLow: true, dealScore: 0,
    });
    return id;
  }

  it('defaults to the HLTB basis for $/hour', () => {
    const id = seedToggleGame();
    const game = getEnrichedGameById(id, 'default');
    expect(game?.playtimeSource).toBe('hltb');
    expect(game?.dollarsPerHour).toBeCloseTo(2.0, 5); // 20 / 10h
  });

  it('switches $/hour to the Steam-review median when toggled to steam_reviews', () => {
    const id = seedToggleGame();
    setPlaytimeSource(id, 'steam_reviews', 'default');
    const game = getEnrichedGameById(id, 'default');
    expect(game?.playtimeSource).toBe('steam_reviews');
    expect(game?.dollarsPerHour).toBeCloseTo(0.5, 5); // 20 / 40h
  });

  it('reverts $/hour to HLTB when toggled back, and the stored deal score round-trips', () => {
    const id = seedToggleGame();

    // Live HLTB-basis score (the seeded stored dealScore is a deliberately stale 0).
    const hltbScore = getEnrichedGameById(id, 'default')?.dealScore;

    setPlaytimeSource(id, 'steam_reviews', 'default');
    const steamGame = getEnrichedGameById(id, 'default');
    const steamStored = getLatestPriceSnapshots([id]).get(id)?.dealScore;
    expect(steamGame?.dollarsPerHour).toBeCloseTo(0.5, 5);
    // The basis change shifts the value component → a different score, and the
    // stored sort key tracks the live badge after the toggle.
    expect(steamStored).toBe(steamGame?.dealScore);
    expect(steamGame?.dealScore).not.toBe(hltbScore);

    setPlaytimeSource(id, 'hltb', 'default');
    const backGame = getEnrichedGameById(id, 'default');
    const backStored = getLatestPriceSnapshots([id]).get(id)?.dealScore;
    expect(backGame?.playtimeSource).toBe('hltb');
    expect(backGame?.dollarsPerHour).toBeCloseTo(2.0, 5);
    expect(backGame?.dealScore).toBe(hltbScore); // live score round-tripped to the original
    expect(backStored).toBe(backGame?.dealScore); // stored sort key tracks the badge
  });

  it('falls back to the Steam median for $/hour when HLTB is missing (gap-fill, default source)', () => {
    const id = seedGame(testDb, {
      steamAppId: 921, title: 'No HLTB', reviewScore: 90,
      hltbMain: null, steamPlaytimeMedian: 25, steamPlaytimeSampleSize: 80,
    });
    seedUserGame(testDb, id, { isWishlisted: true });
    seedPriceSnapshot(testDb, id, { priceCurrent: 20, priceRegular: 40, historicalLowPrice: 20, isHistoricalLow: true });

    const game = getEnrichedGameById(id, 'default');
    expect(game?.playtimeSource).toBe('hltb'); // preference untouched...
    expect(game?.dollarsPerHour).toBeCloseTo(0.8, 5); // ...but $/hour falls back to 20 / 25h
  });

  it('does NOT borrow the review median for an unreleased game (no HLTB, isReleased=false)', () => {
    const id = seedGame(testDb, {
      steamAppId: 923, title: 'Not Out Yet', reviewScore: 90,
      hltbMain: null, steamPlaytimeMedian: 25, steamPlaytimeSampleSize: 80, isReleased: false,
    });
    seedUserGame(testDb, id, { isWishlisted: true });
    seedPriceSnapshot(testDb, id, { priceCurrent: 20, priceRegular: 40, historicalLowPrice: 20, isHistoricalLow: true });

    // Fallback suppressed for an unreleased game → no usable hours → no $/hour figure.
    expect(getEnrichedGameById(id, 'default')?.dollarsPerHour).toBeUndefined();
  });

  it('updateGameSteamPlaytime recompute lifts the stored score for a steam_reviews game once a median lands', () => {
    const id = seedGame(testDb, {
      steamAppId: 922, title: 'Median Later', reviewScore: 90,
      hltbMain: 10, steamPlaytimeMedian: null,
    });
    seedUserGame(testDb, id, { isWishlisted: true, playtimeSource: 'steam_reviews' });
    seedPriceSnapshot(testDb, id, { priceCurrent: 20, priceRegular: 40, historicalLowPrice: 20, isHistoricalLow: true, dealScore: 0 });

    // Source is steam_reviews but no median yet → falls back to HLTB (10h → $2/h).
    const before = getEnrichedGameById(id, 'default');
    expect(before?.dollarsPerHour).toBeCloseTo(2.0, 5);

    // Median lands; the writer recomputes the stored score against the new basis.
    updateGameSteamPlaytime(id, { medianHours: 40, sampleSize: 150 });
    const after = getEnrichedGameById(id, 'default');
    const stored = getLatestPriceSnapshots([id]).get(id)?.dealScore;
    expect(after?.dollarsPerHour).toBeCloseTo(0.5, 5); // now 20 / 40h
    expect(stored).toBe(after?.dealScore);
  });
});

describe('value received (owned games)', () => {
  it('populates the time-lens tier for an owned game with no recorded price', () => {
    const gameId = seedGame(testDb, { steamAppId: 700, title: 'Hades', reviewScore: 96, hltbMain: 22 });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 2640 }); // 44h / 22h = 2.0

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.valueReceivedTier).toBe('exceeded');
    expect(game?.valueReceivedLens).toBe('time');
    expect(game?.completionRatio).toBe(2);
    expect(game?.realizedDollarsPerHour).toBeUndefined();
  });

  it('switches to the money lens once a price is recorded', () => {
    const gameId = seedGame(testDb, { steamAppId: 701, title: 'Celeste', reviewScore: 96, hltbMain: 8 });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 2460, pricePaid: 24.99 }); // 41h

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.valueReceivedLens).toBe('money');
    expect(game?.pricePaid).toBe(24.99);
    expect(game?.realizedDollarsPerHour).toBe(0.61);
    expect(game?.valueReceivedTier).toBe('exceeded');
    expect(game?.receivedExpectedValue).toBe(true);
  });

  it('does not compute value received for non-owned (wishlist) games', () => {
    const gameId = seedGame(testDb, { steamAppId: 702, title: 'Hollow Knight', reviewScore: 95, hltbMain: 27 });
    seedUserGame(testDb, gameId, { isOwned: false, isWishlisted: true, playtimeMinutes: 0 });

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.valueReceivedTier).toBeUndefined();
    expect(game?.valueReceivedLens).toBeUndefined();
  });

  it('surfaces value received through the list query as well', () => {
    const gameId = seedGame(testDb, { steamAppId: 703, title: 'Stardew Valley', reviewScore: 98, hltbMain: 52 });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 312 }); // 5.2h / 52h = 0.1 → unrealized

    const result = getEnrichedGames({ view: 'library' }, undefined, undefined, 'default');
    const sv = result.games.find((g) => g.title === 'Stardew Valley');
    expect(sv?.valueReceivedTier).toBe('unrealized');
    expect(sv?.valueReceivedLens).toBe('time');
  });

  it('reports the "none" lens for a played game with no HLTB and no price (no honest baseline)', () => {
    const gameId = seedGame(testDb, { steamAppId: 704, title: 'Age of Empires II', reviewScore: 95, hltbMain: null });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 6000 }); // 100h, no duration, no price

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.valueReceivedLens).toBe('none');
    // Tier carries an inert placeholder; the UI keys off the 'none' lens, not the tier.
    expect(game?.realizedDollarsPerHour).toBeUndefined();
  });
});

describe('capturePricePaidSuggestions (price-paid suggestion capture)', () => {
  it('writes a suggestion from the latest snapshot for a newly-owned game with no recorded price', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    seedPriceSnapshot(testDb, gameId, { priceCurrent: 8.99, snapshotDate: '2026-05-01' });

    const captured = capturePricePaidSuggestions([gameId], 'default');
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ gameId, title: 'TF2', suggested: 8.99, asOf: '2026-05-01' });
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidSuggested).toBe(8.99);
  });

  it('picks the cheapest store on the most recent snapshot date', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    seedPriceSnapshot(testDb, gameId, { store: 'steam', priceCurrent: 12.0, snapshotDate: '2026-05-02' });
    seedPriceSnapshot(testDb, gameId, { store: 'gog', priceCurrent: 9.5, snapshotDate: '2026-05-02' });
    // An older, cheaper snapshot must be ignored — only the latest date counts.
    seedPriceSnapshot(testDb, gameId, { store: 'humble', priceCurrent: 4.0, snapshotDate: '2026-04-01' });

    const captured = capturePricePaidSuggestions([gameId], 'default');
    expect(captured[0].suggested).toBe(9.5);
  });

  it('makes no suggestion when the game has no price snapshot (honest boundary)', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });

    const captured = capturePricePaidSuggestions([gameId], 'default');
    expect(captured).toHaveLength(0);
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidSuggested).toBeNull();
  });

  it('makes no suggestion for a free/$0 snapshot', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    seedPriceSnapshot(testDb, gameId, { priceCurrent: 0, priceRegular: 0, discountPercent: 0 });

    const captured = capturePricePaidSuggestions([gameId], 'default');
    expect(captured).toHaveLength(0);
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidSuggested).toBeNull();
  });

  it('never clobbers a price the user already recorded', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaid: 59.99 });
    seedPriceSnapshot(testDb, gameId, { priceCurrent: 8.99 });

    const captured = capturePricePaidSuggestions([gameId], 'default');
    expect(captured).toHaveLength(0);
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaid).toBe(59.99);
    expect(row?.pricePaidSuggested).toBeNull();
  });

  it('clears a stale dismissal when a fresh suggestion is captured', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, {
      isOwned: true,
      pricePaidSuggestionDismissedAt: '2026-01-01T00:00:00.000Z',
    });
    seedPriceSnapshot(testDb, gameId, { priceCurrent: 8.99 });

    capturePricePaidSuggestions([gameId], 'default');
    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, gameId)).get();
    expect(row?.pricePaidSuggested).toBe(8.99);
    expect(row?.pricePaidSuggestionDismissedAt).toBeNull();
  });
});

describe('getEnrichedGame — hasPricePaidSuggestion flag', () => {
  it('is true for an owned game with an un-dismissed suggestion and no recorded price', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaidSuggested: 8.99 });

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.hasPricePaidSuggestion).toBe(true);
    expect(game?.pricePaidSuggested).toBe(8.99);
  });

  it('is false once a real price is recorded', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaid: 8.99, pricePaidSuggested: 8.99 });

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.hasPricePaidSuggestion).toBe(false);
  });

  it('is false once the suggestion is dismissed', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, {
      isOwned: true,
      pricePaidSuggested: 8.99,
      pricePaidSuggestionDismissedAt: '2026-05-01T00:00:00.000Z',
    });

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.hasPricePaidSuggestion).toBe(false);
  });

  it('surfaces the flag through the list query too', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaidSuggested: 8.99 });

    const result = getEnrichedGames({ view: 'library' }, undefined, undefined, 'default');
    const g = result.games.find((x) => x.id === gameId);
    expect(g?.hasPricePaidSuggestion).toBe(true);
  });
});

describe('getEnrichedGames — "Most Value Waiting" sort (valueWaiting)', () => {
  it('ranks highly-rated, lots-unplayed games above played-through and unsized ones', () => {
    // All owned, default interest (3); review held constant so remaining unplayed
    // content drives the order: remaining = (1 − min(1, played/hltb)) × hltb.
    const gem = seedGame(testDb, { steamAppId: 800, title: 'Unplayed Gem', reviewScore: 95, hltbMain: 40 });
    seedUserGame(testDb, gem, { isOwned: true, playtimeMinutes: 0 }); // 40h remaining → highest

    const half = seedGame(testDb, { steamAppId: 801, title: 'Half Played', reviewScore: 95, hltbMain: 40 });
    seedUserGame(testDb, half, { isOwned: true, playtimeMinutes: 1200 }); // 20h played → 20h remaining

    const done = seedGame(testDb, { steamAppId: 802, title: 'Finished', reviewScore: 95, hltbMain: 40 });
    seedUserGame(testDb, done, { isOwned: true, playtimeMinutes: 2400 }); // fully played → 0 remaining

    // No HLTB sizing → 0 remaining (we don't claim unplayed value we can't measure) → sorts last.
    const unsized = seedGame(testDb, { steamAppId: 803, title: 'No Duration', reviewScore: 95 });
    seedUserGame(testDb, unsized, { isOwned: true, playtimeMinutes: 0 });

    const result = getEnrichedGames(
      { view: 'library', sortBy: 'valueWaiting', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    );
    const order = result.games.map((g) => g.title);

    expect(order[0]).toBe('Unplayed Gem');
    expect(order[1]).toBe('Half Played');
    // Both zero-remaining games (played-through and unsized) rank below the rest.
    expect(order.indexOf('Unplayed Gem')).toBeLessThan(order.indexOf('Finished'));
    expect(order.indexOf('Unplayed Gem')).toBeLessThan(order.indexOf('No Duration'));
    expect(order.indexOf('Half Played')).toBeLessThan(order.indexOf('Finished'));
  });

  it('weights review quality and personal interest, not just remaining hours', () => {
    // Identical remaining content (both unplayed, same HLTB); review × interest breaks the tie.
    const strong = seedGame(testDb, { steamAppId: 810, title: 'Strong Signal', reviewScore: 95, hltbMain: 20 });
    seedUserGame(testDb, strong, { isOwned: true, playtimeMinutes: 0, personalInterest: 5 });

    const weak = seedGame(testDb, { steamAppId: 811, title: 'Weak Signal', reviewScore: 60, hltbMain: 20 });
    seedUserGame(testDb, weak, { isOwned: true, playtimeMinutes: 0, personalInterest: 1 });

    const result = getEnrichedGames(
      { view: 'library', sortBy: 'valueWaiting', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    );
    const order = result.games.map((g) => g.title);
    expect(order.indexOf('Strong Signal')).toBeLessThan(order.indexOf('Weak Signal'));
  });
});

describe('getEnrichedGames — Value Received sorts', () => {
  it('sorts by price paid (desc = most expensive first; unpriced last)', () => {
    const a = seedGame(testDb, { steamAppId: 820, title: 'Pricey' });
    seedUserGame(testDb, a, { isOwned: true, pricePaid: 59.99 });
    const b = seedGame(testDb, { steamAppId: 821, title: 'Cheap' });
    seedUserGame(testDb, b, { isOwned: true, pricePaid: 4.99 });
    const c = seedGame(testDb, { steamAppId: 822, title: 'Unpriced' });
    seedUserGame(testDb, c, { isOwned: true });

    const order = getEnrichedGames(
      { view: 'library', sortBy: 'pricePaid', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    ).games.map((g) => g.title);

    expect(order[0]).toBe('Pricey');
    expect(order[1]).toBe('Cheap');
    expect(order.indexOf('Unpriced')).toBe(order.length - 1);
  });

  it('sorts by realized $/hr (asc = best ROI first)', () => {
    const cheap = seedGame(testDb, { steamAppId: 830, title: 'Great ROI', reviewScore: 90 });
    seedUserGame(testDb, cheap, { isOwned: true, pricePaid: 10, playtimeMinutes: 6000 }); // $0.10/hr
    const dear = seedGame(testDb, { steamAppId: 831, title: 'Poor ROI', reviewScore: 90 });
    seedUserGame(testDb, dear, { isOwned: true, pricePaid: 60, playtimeMinutes: 60 }); // $60/hr

    const order = getEnrichedGames(
      { view: 'library', sortBy: 'realizedDollarsPerHour', sortOrder: 'asc' },
      undefined,
      undefined,
      'default'
    ).games.map((g) => g.title);

    expect(order.indexOf('Great ROI')).toBeLessThan(order.indexOf('Poor ROI'));
  });

  it('sorts by completion ratio (desc = most finished first)', () => {
    const done = seedGame(testDb, { steamAppId: 840, title: 'Finished', hltbMain: 10 });
    seedUserGame(testDb, done, { isOwned: true, playtimeMinutes: 900 }); // 15h / 10h = 1.5
    const barely = seedGame(testDb, { steamAppId: 841, title: 'Barely Touched', hltbMain: 10 });
    seedUserGame(testDb, barely, { isOwned: true, playtimeMinutes: 60 }); // 1h / 10h = 0.1

    const order = getEnrichedGames(
      { view: 'library', sortBy: 'completionRatio', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    ).games.map((g) => g.title);

    expect(order.indexOf('Finished')).toBeLessThan(order.indexOf('Barely Touched'));
  });

  it('sorts by value received tier (desc = exceeded first; no-baseline last)', () => {
    // Time lens: 2.0 ratio → exceeded.
    const exceeded = seedGame(testDb, { steamAppId: 850, title: 'Exceeded', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, exceeded, { isOwned: true, playtimeMinutes: 1200 });
    // Time lens: 0.1 ratio → unrealized.
    const unrealized = seedGame(testDb, { steamAppId: 851, title: 'Unrealized', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, unrealized, { isOwned: true, playtimeMinutes: 60 });
    // No HLTB, no price, played → no baseline → sorts last.
    const none = seedGame(testDb, { steamAppId: 852, title: 'No Baseline', reviewScore: 90, hltbMain: null });
    seedUserGame(testDb, none, { isOwned: true, playtimeMinutes: 600 });

    const order = getEnrichedGames(
      { view: 'library', sortBy: 'valueReceived', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    ).games.map((g) => g.title);

    expect(order[0]).toBe('Exceeded');
    expect(order.indexOf('Exceeded')).toBeLessThan(order.indexOf('Unrealized'));
    expect(order.indexOf('No Baseline')).toBe(order.length - 1);
  });
});

describe('getEnrichedGames — library default sort leads with Value Received (R14)', () => {
  it('the /library default filters surface highest realized value first', () => {
    // Time lens 2.0 ratio → exceeded.
    const exceeded = seedGame(testDb, { steamAppId: 900, title: 'Got My Money Worth', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, exceeded, { isOwned: true, playtimeMinutes: 1200 });
    // Time lens 0.1 ratio → unrealized.
    const unrealized = seedGame(testDb, { steamAppId: 901, title: 'Barely Touched', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, unrealized, { isOwned: true, playtimeMinutes: 60 });

    // Exactly the default filter object the library page builds (no URL overrides).
    const order = getEnrichedGames(
      { view: 'library', sortBy: 'valueReceived', sortOrder: 'desc' },
      undefined,
      undefined,
      'default'
    ).games.map((g) => g.title);

    expect(order.indexOf('Got My Money Worth')).toBeLessThan(order.indexOf('Barely Touched'));
  });
});

describe('getEnrichedGames — Value Received filters (R14)', () => {
  it('filters by rated / unrated on the user post-play rating', () => {
    const rated = seedGame(testDb, { steamAppId: 910, title: 'Rated Game', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, rated, { isOwned: true, playtimeMinutes: 600, enjoymentRating: 5 });
    const alsoRated = seedGame(testDb, { steamAppId: 911, title: 'Disliked Game', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, alsoRated, { isOwned: true, playtimeMinutes: 600, enjoymentRating: 2 });
    const unrated = seedGame(testDb, { steamAppId: 912, title: 'Unrated Game', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, unrated, { isOwned: true, playtimeMinutes: 600 });

    const ratedTitles = getEnrichedGames({ view: 'library', rated: true }, undefined, undefined, 'default')
      .games.map((g) => g.title);
    expect(ratedTitles.sort()).toEqual(['Disliked Game', 'Rated Game']);

    const unratedTitles = getEnrichedGames({ view: 'library', rated: false }, undefined, undefined, 'default')
      .games.map((g) => g.title);
    expect(unratedTitles).toEqual(['Unrated Game']);
  });

  it('filters by Value Received tier, matching the donut bucketing exactly (incl. effective-playtime fallback)', () => {
    // Default thresholds (no settings seeded): review 90 → veryPositive $3.00/hr target.
    // Covers money + time lenses AND the effective-playtime path that the donut/badges use but the
    // SQL previously ignored: HLTB-less games fall back to steam_playtime_median, and a steam_reviews
    // basis grades off the median even when an HLTB value exists.
    const specs = [
      { appId: 920, title: 'MoneyExceeded',       review: 90, hltb: 10,   median: null, source: 'hltb',          price: 10,   mins: 6000 }, // $0.10/hr → exceeded (money)
      { appId: 921, title: 'MoneyUnrealized',     review: 90, hltb: 10,   median: null, source: 'hltb',          price: 60,   mins: 60   }, // $60/hr → unrealized (money)
      { appId: 922, title: 'TimeExceeded',        review: 90, hltb: 10,   median: null, source: 'hltb',          price: null, mins: 1200 }, // 20h/10h → exceeded (time, HLTB)
      { appId: 923, title: 'TimeUnrealized',      review: 90, hltb: 10,   median: null, source: 'hltb',          price: null, mins: 60   }, // 1h/10h → unrealized (time, HLTB)
      { appId: 924, title: 'MedianRealized',      review: 90, hltb: null, median: 20,   source: 'hltb',          price: null, mins: 1200 }, // HLTB NULL → median 20h; 20h/20h → realized
      { appId: 925, title: 'SteamBasisExceeded',  review: 90, hltb: 10,   median: 5,    source: 'steam_reviews', price: null, mins: 600  }, // steam basis → median 5h; 10h/5h → exceeded (HLTB would say realized)
      { appId: 926, title: 'NoBaseline',          review: 90, hltb: null, median: null, source: 'hltb',          price: null, mins: 600  }, // no HLTB, no median → 'none'
    ];
    for (const s of specs) {
      const g = seedGame(testDb, {
        steamAppId: s.appId,
        title: s.title,
        reviewScore: s.review,
        hltbMain: s.hltb,
        steamPlaytimeMedian: s.median,
      });
      seedUserGame(testDb, g, { isOwned: true, playtimeMinutes: s.mins, pricePaid: s.price, playtimeSource: s.source });
    }

    // Expected bucket per game via the DONUT's exact per-game logic (getValueReceivedOverview):
    // effective playtime hours via getEffectivePlaytimeHours (isReleased omitted, exactly as the
    // donut/badges call it), then calculateValueReceived → lens/tier. This pins the SQL filter to
    // the same computation the cards + donut show, so they can never silently disagree.
    const donutBucket = (s: (typeof specs)[number]) => {
      const vr = calculateValueReceived({
        playtimeMinutes: s.mins,
        hltbMainHours: getEffectivePlaytimeHours({
          playtimeSource: s.source,
          hltbMain: s.hltb,
          steamPlaytimeMedian: s.median,
        }),
        reviewPercent: s.review,
        pricePaid: s.price,
      });
      return vr.lens === 'none' ? 'none' : vr.tier;
    };

    const expectedFor = (tier: 'exceeded' | 'realized' | 'approaching' | 'unrealized') =>
      specs.filter((s) => donutBucket(s) === tier).map((s) => s.title).sort();

    for (const tier of ['exceeded', 'realized', 'approaching', 'unrealized'] as const) {
      const got = getEnrichedGames({ view: 'library', valueReceivedTier: tier }, undefined, undefined, 'default')
        .games.map((g) => g.title)
        .sort();
      expect(got).toEqual(expectedFor(tier));
    }

    // Explicit guard for the previously-broken case: the median-fallback game is a real tier
    // (matching its card + donut slice), not silently dropped from every filter.
    expect(donutBucket(specs.find((s) => s.title === 'MedianRealized')!)).toBe('realized');
    expect(
      getEnrichedGames({ view: 'library', valueReceivedTier: 'realized' }, undefined, undefined, 'default')
        .games.map((g) => g.title),
    ).toContain('MedianRealized');

    // The no-baseline game is bucketed 'none' and therefore appears under no tier filter.
    const allTierMatches = (['exceeded', 'realized', 'approaching', 'unrealized'] as const).flatMap((tier) =>
      getEnrichedGames({ view: 'library', valueReceivedTier: tier }, undefined, undefined, 'default').games.map((g) => g.title),
    );
    expect(allTierMatches).not.toContain('NoBaseline');
  });
});

describe('getValueReceivedOverview', () => {
  it('buckets owned games by tier and rolls up spend/value stats', () => {
    // Money lens, $0.61/hr vs OP $4 target → exceeded, received expected value.
    const a = seedGame(testDb, { steamAppId: 860, title: 'Celeste', reviewScore: 96, hltbMain: 8 });
    seedUserGame(testDb, a, { isOwned: true, playtimeMinutes: 2460, pricePaid: 24.99 });
    // Time lens, 0.1 ratio → unrealized, no price.
    const b = seedGame(testDb, { steamAppId: 861, title: 'Backlog Item', reviewScore: 90, hltbMain: 50 });
    seedUserGame(testDb, b, { isOwned: true, playtimeMinutes: 300 });
    // No HLTB, no price, played → none bucket.
    const c = seedGame(testDb, { steamAppId: 862, title: 'Sandbox', reviewScore: 90, hltbMain: null });
    seedUserGame(testDb, c, { isOwned: true, playtimeMinutes: 6000 });
    // Wishlist-only game must be ignored entirely.
    const w = seedGame(testDb, { steamAppId: 863, title: 'Wishlisted', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, w, { isOwned: false, isWishlisted: true, playtimeMinutes: 0 });

    const overview = getValueReceivedOverview('default');
    const counts = Object.fromEntries(overview.distribution.map((d) => [d.bucket, d.count]));

    expect(counts.exceeded).toBe(1);
    expect(counts.unrealized).toBe(1);
    expect(counts.none).toBe(1);
    expect(overview.stats.pricedGames).toBe(1);
    expect(overview.stats.totalSpent).toBe(24.99);
    expect(overview.stats.moneyLensGames).toBe(1);
    expect(overview.stats.expectedValueHits).toBe(1);
    expect(overview.stats.blendedDollarsPerHour).toBe(0.61);
  });

  it('returns all-zero buckets and null blended $/hr for an empty library', () => {
    const overview = getValueReceivedOverview('default');
    expect(overview.distribution.every((d) => d.count === 0)).toBe(true);
    expect(overview.stats.blendedDollarsPerHour).toBeNull();
    expect(overview.stats.totalSpent).toBe(0);
  });
});

describe('getEnrichedGameById', () => {
  it('returns game for valid ID', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    const game = getEnrichedGameById(gameId, 'default');
    expect(game).not.toBeNull();
    expect(game?.title).toBe('TF2');
  });

  it('returns null for non-existent ID', () => {
    const game = getEnrichedGameById(99999, 'default');
    expect(game).toBeNull();
  });

  it('includes price data from snapshots', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true });
    seedPriceSnapshot(testDb, gameId, {
      priceCurrent: 9.99,
      priceRegular: 19.99,
      discountPercent: 50,
    });

    const game = getEnrichedGameById(gameId, 'default');
    expect(game?.currentPrice).toBe(9.99);
    expect(game?.regularPrice).toBe(19.99);
    expect(game?.discountPercent).toBe(50);
  });
});

// ============================================
// Dashboard Stats
// ============================================

describe('getDashboardStats', () => {
  it('returns correct counts', () => {
    const g1 = seedGame(testDb, { steamAppId: 100, title: 'A' });
    const g2 = seedGame(testDb, { steamAppId: 200, title: 'B' });
    const g3 = seedGame(testDb, { steamAppId: 300, title: 'C' });

    seedUserGame(testDb, g1, { isOwned: true, playtimeMinutes: 120 });
    seedUserGame(testDb, g2, { isOwned: true, isWishlisted: true, playtimeMinutes: 60 });
    seedUserGame(testDb, g3, { isWishlisted: true, isWatchlisted: true });

    const stats = getDashboardStats('default');
    expect(stats.libraryCount).toBe(2);
    expect(stats.wishlistCount).toBe(2);
    expect(stats.watchlistCount).toBe(1);
    expect(stats.totalPlaytimeHours).toBe(3); // (120+60)/60 = 3
  });
});

// ============================================
// Sync Log
// ============================================

describe('sync log', () => {
  it('creates and completes a sync log', () => {
    const logId = createSyncLog('steam_library');
    expect(logId).toBeGreaterThan(0);

    completeSyncLog(logId, 'success', 42);
    const logs = getRecentSyncLogs(1);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('success');
    expect(logs[0].itemsProcessed).toBe(42);
  });

  it('records error message on failure', () => {
    const logId = createSyncLog('itad_prices');
    completeSyncLog(logId, 'error', 0, 'API rate limited');

    const logs = getRecentSyncLogs(1);
    expect(logs[0].errorMessage).toBe('API rate limited');
  });
});

// ============================================
// Price Snapshots
// ============================================

describe('price snapshots', () => {
  it('inserts and retrieves latest snapshot', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    insertPriceSnapshot({
      gameId,
      store: 'steam',
      priceCurrent: 9.99,
      priceRegular: 19.99,
      discountPercent: 50,
      isHistoricalLow: true,
      historicalLowPrice: 9.99,
    });

    const snapshots = getLatestPriceSnapshots([gameId]);
    expect(snapshots.size).toBe(1);
    const snap = snapshots.get(gameId)!;
    expect(snap.priceCurrent).toBe(9.99);
    expect(snap.isHistoricalLow).toBe(true);
  });

  it('getPriceHistory returns ordered results', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: '2025-01-01', priceCurrent: 20 });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: '2025-02-01', priceCurrent: 15 });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: '2025-03-01', priceCurrent: 10 });

    const history = getPriceHistory(gameId, 10);
    expect(history).toHaveLength(3);
    expect(history[0].snapshotDate).toBe('2025-03-01'); // Most recent first
    expect(history[2].snapshotDate).toBe('2025-01-01');
  });

  it('getDealsCount counts discounted games', () => {
    const g1 = seedGame(testDb, { steamAppId: 100, title: 'A' });
    const g2 = seedGame(testDb, { steamAppId: 200, title: 'B' });
    seedPriceSnapshot(testDb, g1, { discountPercent: 50 });
    seedPriceSnapshot(testDb, g2, { discountPercent: 0 });

    const count = getDealsCount();
    expect(count).toBe(1);
  });
});

// ============================================
// Price Alerts
// ============================================

describe('price alerts', () => {
  let gameId: number;

  beforeEach(() => {
    gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    seedUserGame(testDb, gameId, { isOwned: true, isWatchlisted: true });
  });

  it('upsertPriceAlert creates new alert', () => {
    const alertId = upsertPriceAlert(gameId, { targetPrice: 9.99 }, 'default');
    expect(alertId).toBeGreaterThan(0);
  });

  it('upsertPriceAlert updates existing alert (unique constraint)', () => {
    const id1 = upsertPriceAlert(gameId, { targetPrice: 9.99 }, 'default');
    const id2 = upsertPriceAlert(gameId, { targetPrice: 4.99 }, 'default');
    expect(id2).toBe(id1);

    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert?.targetPrice).toBe(4.99);
  });

  it('getPriceAlertForGame returns alert', () => {
    upsertPriceAlert(gameId, { targetPrice: 15.00, notifyOnAllTimeLow: false }, 'default');
    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert).not.toBeNull();
    expect(alert?.targetPrice).toBe(15.00);
    expect(alert?.notifyOnAllTimeLow).toBe(false);
  });

  it('getPriceAlertForGame returns null when no alert exists', () => {
    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert).toBeNull();
  });

  it('getActivePriceAlerts returns active alerts with price data', () => {
    upsertPriceAlert(gameId, { targetPrice: 10.00 }, 'default');
    seedPriceSnapshot(testDb, gameId, {
      priceCurrent: 9.99,
      priceRegular: 19.99,
      discountPercent: 50,
    });

    const alerts = getActivePriceAlerts('default');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('TF2');
    expect(alerts[0].currentPrice).toBe(9.99);
  });

  it('updatePriceAlert updates alert settings', () => {
    const alertId = upsertPriceAlert(gameId, { targetPrice: 10 }, 'default');
    const updated = updatePriceAlert(alertId, { isActive: false }, 'default');
    expect(updated).toBe(true);

    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert?.isActive).toBe(false);
  });

  it('updatePriceAlert returns false for non-existent alert', () => {
    const updated = updatePriceAlert(99999, { isActive: false }, 'default');
    expect(updated).toBe(false);
  });

  it('deletePriceAlert removes alert', () => {
    const alertId = upsertPriceAlert(gameId, { targetPrice: 10 }, 'default');
    const deleted = deletePriceAlert(alertId, 'default');
    expect(deleted).toBe(true);

    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert).toBeNull();
  });

  it('deletePriceAlert returns false for non-existent alert', () => {
    const deleted = deletePriceAlert(99999, 'default');
    expect(deleted).toBe(false);
  });

  it('updateAlertLastNotified sets timestamp', () => {
    const alertId = upsertPriceAlert(gameId, { targetPrice: 10 }, 'default');
    updateAlertLastNotified(alertId);

    const alert = getPriceAlertForGame(gameId, 'default');
    expect(alert?.lastNotifiedAt).not.toBeNull();
  });

  it('getAllPriceAlertsWithGames returns all alerts with game data', () => {
    upsertPriceAlert(gameId, { targetPrice: 10 }, 'default');
    const alerts = getAllPriceAlertsWithGames('default');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('TF2');
  });

  it('getAlertStats returns correct counts', () => {
    upsertPriceAlert(gameId, { targetPrice: 10 }, 'default');

    const g2 = seedGame(testDb, { steamAppId: 570, title: 'Dota 2' });
    seedUserGame(testDb, g2, { isOwned: true, isWatchlisted: true });
    const alertId2 = upsertPriceAlert(g2, { targetPrice: 5 }, 'default');
    updatePriceAlert(alertId2, { isActive: false }, 'default');

    const stats = getAlertStats('default');
    expect(stats.activeCount).toBe(1);
  });
});

// ============================================
// Backlog / Genre Queries
// ============================================

describe('genres and backlog', () => {
  it('getAllGenres returns genre names', () => {
    const gameId = seedGame(testDb, { steamAppId: 440, title: 'TF2' });
    upsertTags(gameId, ['Action', 'FPS'], 'genre');

    const genres = getAllGenres();
    expect(genres).toContain('Action');
    expect(genres).toContain('FPS');
  });

  it('getBacklogStats returns correct counts', () => {
    const g1 = seedGame(testDb, { steamAppId: 100, title: 'A' });
    const g2 = seedGame(testDb, { steamAppId: 200, title: 'B' });
    const g3 = seedGame(testDb, { steamAppId: 300, title: 'C' });

    seedUserGame(testDb, g1, { isOwned: true, playtimeMinutes: 0 });
    seedUserGame(testDb, g2, { isOwned: true, playtimeMinutes: 120 });
    seedUserGame(testDb, g3, { isOwned: true, playtimeMinutes: 0 });

    const stats = getBacklogStats('default');
    expect(stats.totalOwned).toBe(3);
    expect(stats.unplayedCount).toBe(2);
  });
});

// ============================================
// countGames
// ============================================

describe('countGames', () => {
  beforeEach(() => {
    const g1 = seedGame(testDb, { steamAppId: 100, title: 'Alpha', reviewScore: 90, hltbMain: 10 });
    const g2 = seedGame(testDb, { steamAppId: 200, title: 'Beta', reviewScore: null, hltbMain: 5 });
    const g3 = seedGame(testDb, { steamAppId: 300, title: 'Charlie', reviewScore: 60, hltbMain: 20 });

    seedUserGame(testDb, g1, { isOwned: true, playtimeMinutes: 600 });
    seedUserGame(testDb, g2, { isOwned: true, playtimeMinutes: 0 });
    seedUserGame(testDb, g3, { isOwned: true, playtimeMinutes: 0, isIgnored: true });

    // Add genres to g1 and g2
    upsertTags(g1, ['Action', 'RPG'], 'genre');
    upsertTags(g2, ['Puzzle'], 'genre');

    // Add price snapshots
    seedPriceSnapshot(testDb, g1, { priceCurrent: 9.99, priceRegular: 19.99, discountPercent: 50 });
    seedPriceSnapshot(testDb, g2, { priceCurrent: 4.99, priceRegular: 4.99, discountPercent: 0 });
    seedPriceSnapshot(testDb, g3, { priceCurrent: 14.99, priceRegular: 29.99, discountPercent: 50 });
  });

  it('no filters returns total count', () => {
    const count = countGames({}, 'default');
    expect(count).toBe(3);
  });

  it('playtimeStatus backlog excludes games with high playtime', () => {
    // g1 has 600 min playtime with 10h HLTB = 100% completion, not backlog
    // g2 has 0 playtime = backlog
    // g3 has 0 playtime but isIgnored = excluded from backlog
    const count = countGames({ playtimeStatus: 'backlog' }, 'default');
    expect(count).toBe(1); // only g2
  });

  it('minReview with strictFilters excludes NULL review games', () => {
    const count = countGames({ minReview: 70, strictFilters: true }, 'default');
    // g1 has 90 (passes), g2 has null (excluded by strict), g3 has 60 (below 70)
    expect(count).toBe(1);
  });

  it('genres filter only counts games with matching genre tags', () => {
    const count = countGames({ genres: ['Action'] }, 'default');
    expect(count).toBe(1); // only g1
  });

  it('maxPrice filter only counts games at or below threshold', () => {
    const count = countGames({ maxPrice: 5.00 }, 'default');
    expect(count).toBe(1); // only g2 at 4.99
  });

  it('isIgnored games excluded from backlog count', () => {
    // g3 is ignored with 0 playtime — would be backlog but isIgnored excludes it
    const count = countGames({ playtimeStatus: 'backlog' }, 'default');
    expect(count).toBe(1); // g2 only, g3 excluded by isIgnored
  });
});

// ============================================
// Settings-backed thresholds
// ============================================

describe('settings-backed thresholds', () => {
  // The backlog/play-again thresholds share a 60s in-memory cache keyed on
  // Date.now() — advance past the TTL between tests so each seeded setting is
  // re-read (mirrors the getScoringConfig test pattern).
  let timeOffset = 0;
  const realDateNow = Date.now;

  beforeEach(() => {
    timeOffset += 61_000;
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + timeOffset);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('getBacklogThreshold', () => {
    it('returns default when no setting exists', () => {
      expect(getBacklogThreshold()).toBe(10);
    });

    it('returns custom value when setting is present', () => {
      seedSetting(testDb, 'backlog_threshold_percent', '25');
      expect(getBacklogThreshold()).toBe(25);
    });
  });

  describe('getPlayAgainCompletionPct', () => {
    it('returns default when no setting exists', () => {
      expect(getPlayAgainCompletionPct()).toBe(50);
    });

    it('returns custom value when setting is present', () => {
      seedSetting(testDb, 'play_again_completion_pct', '75');
      expect(getPlayAgainCompletionPct()).toBe(75);
    });
  });

  describe('getPlayAgainDormantMonths', () => {
    it('returns default when no setting exists', () => {
      expect(getPlayAgainDormantMonths()).toBe(24);
    });

    it('returns custom value when setting is present', () => {
      seedSetting(testDb, 'play_again_dormant_months', '12');
      expect(getPlayAgainDormantMonths()).toBe(12);
    });
  });
});

// ============================================
// Sync-related queries
// ============================================

describe('sync-related queries', () => {
  describe('getGamesForPriceSync', () => {
    it('returns owned OR wishlisted games', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Owned Only' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Wishlisted Only' });
      const g3 = seedGame(testDb, { steamAppId: 300, title: 'Neither' });

      seedUserGame(testDb, g1, { isOwned: true, isWishlisted: false, isWatchlisted: true });
      seedUserGame(testDb, g2, { isOwned: false, isWishlisted: true });
      seedUserGame(testDb, g3, { isOwned: false, isWishlisted: false });

      const result = getGamesForPriceSync('default');
      const titles = result.map(g => g.title);
      // g1 is watchlisted, g2 is wishlisted — both should appear
      expect(titles).toContain('Owned Only');
      expect(titles).toContain('Wishlisted Only');
      expect(titles).not.toContain('Neither');
    });

    it('excludes unreleased games but keeps released and unknown-status games', () => {
      // ITAD reports preorder placeholders ($999) for unreleased games. We skip
      // them at the source. Games with NULL release status are still synced —
      // newly-tracked games may not have status until the release_check runs.
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Released' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Unreleased' });
      const g3 = seedGame(testDb, { steamAppId: 300, title: 'Unknown' });

      upsertGameFromSteam({ steamAppId: 100, title: 'Released', isReleased: true });
      upsertGameFromSteam({ steamAppId: 200, title: 'Unreleased', isReleased: false });
      // g3 keeps isReleased = null (unknown)

      seedUserGame(testDb, g1, { isWishlisted: true });
      seedUserGame(testDb, g2, { isWishlisted: true });
      seedUserGame(testDb, g3, { isWishlisted: true });

      const titles = getGamesForPriceSync('default').map(g => g.title);
      expect(titles).toContain('Released');
      expect(titles).toContain('Unknown');
      expect(titles).not.toContain('Unreleased');
    });
  });

  describe('countOwnedGames', () => {
    it('counts only owned games for the user', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Owned' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Wishlisted' });
      const g3 = seedGame(testDb, { steamAppId: 300, title: 'Owned 2' });
      seedUserGame(testDb, g1, { isOwned: true });
      seedUserGame(testDb, g2, { isOwned: false, isWishlisted: true });
      seedUserGame(testDb, g3, { isOwned: true });

      expect(countOwnedGames('default')).toBe(2);
    });

    it('returns 0 for a fresh library with no owned games', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Wishlisted' });
      seedUserGame(testDb, g1, { isOwned: false, isWishlisted: true });
      expect(countOwnedGames('default')).toBe(0);
    });
  });

  describe('getGamesByIdsForPriceFetch', () => {
    it('returns the given games regardless of wishlist/watchlist status', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Owned Only' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Skipped' });
      seedUserGame(testDb, g1, { isOwned: true, isWishlisted: false, isWatchlisted: false });
      seedUserGame(testDb, g2, { isOwned: true });

      const result = getGamesByIdsForPriceFetch([g1]);
      const titles = result.map((g) => g.title);
      expect(titles).toContain('Owned Only');
      expect(titles).not.toContain('Skipped');
    });

    it('returns an empty array for an empty id list', () => {
      expect(getGamesByIdsForPriceFetch([])).toEqual([]);
    });

    it('excludes unreleased games (ITAD preorder-placeholder guard)', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Released' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Unreleased' });
      upsertGameFromSteam({ steamAppId: 100, title: 'Released', isReleased: true });
      upsertGameFromSteam({ steamAppId: 200, title: 'Unreleased', isReleased: false });
      seedUserGame(testDb, g1, { isOwned: true });
      seedUserGame(testDb, g2, { isOwned: true });

      const titles = getGamesByIdsForPriceFetch([g1, g2]).map((g) => g.title);
      expect(titles).toContain('Released');
      expect(titles).not.toContain('Unreleased');
    });
  });

  describe('getRecentSyncStats', () => {
    it('returns only matching source logs', () => {
      const log1 = createSyncLog('steam_library');
      completeSyncLog(log1, 'success', 10);
      const log2 = createSyncLog('itad_prices');
      completeSyncLog(log2, 'success', 20);
      const log3 = createSyncLog('steam_library');
      completeSyncLog(log3, 'error', 0, 'Failed');

      const stats = getRecentSyncStats('steam_library');
      expect(stats).toHaveLength(2);
      expect(stats.every(s => s.source === 'steam_library')).toBe(true);
    });
  });

  describe('getLastSuccessfulSyncBySource', () => {
    it('returns map of source to completedAt', () => {
      const log1 = createSyncLog('steam_library');
      completeSyncLog(log1, 'success', 10);
      const log2 = createSyncLog('itad_prices');
      completeSyncLog(log2, 'success', 20);
      const log3 = createSyncLog('hltb_enrichment');
      completeSyncLog(log3, 'error', 0, 'Failed');

      const result = getLastSuccessfulSyncBySource();
      expect(result).toHaveProperty('steam_library');
      expect(result).toHaveProperty('itad_prices');
      expect(result).not.toHaveProperty('hltb_enrichment');
    });
  });

  describe('getFirstUserId', () => {
    it('returns user ID when user exists', () => {
      seedUser(testDb, { id: 'user-abc', name: 'Alice', email: 'alice@example.com' });
      expect(getFirstUserId()).toBe('user-abc');
    });

    it('throws when no users exist', () => {
      expect(() => getFirstUserId()).toThrow('No users found');
    });
  });
});

// ============================================
// Release queries
// ============================================

describe('release queries', () => {
  describe('getUnreleasedCount', () => {
    it('returns correct count of unreleased wishlisted games', () => {
      const g1 = seedGame(testDb, { steamAppId: 100, title: 'Unreleased A' });
      const g2 = seedGame(testDb, { steamAppId: 200, title: 'Released B' });
      const g3 = seedGame(testDb, { steamAppId: 300, title: 'Unreleased C' });

      // g1: wishlisted, isReleased = false
      upsertGameFromSteam({ steamAppId: 100, title: 'Unreleased A', isReleased: false });
      seedUserGame(testDb, g1, { isWishlisted: true });

      // g2: wishlisted, isReleased = true
      upsertGameFromSteam({ steamAppId: 200, title: 'Released B', isReleased: true });
      seedUserGame(testDb, g2, { isWishlisted: true });

      // g3: wishlisted, isReleased = null (unknown)
      seedUserGame(testDb, g3, { isWishlisted: true });

      const count = getUnreleasedCount('default');
      // g1 (false) + g3 (null) = 2
      expect(count).toBe(2);
    });
  });

  describe('markGameAsReleased', () => {
    it('sets isReleased to true', () => {
      const gameId = seedGame(testDb, { steamAppId: 100, title: 'Upcoming Game' });
      seedUserGame(testDb, gameId, { isWishlisted: true });

      // Initially not released
      const before = getEnrichedGameById(gameId, 'default');
      expect(before?.isReleased).toBeFalsy();

      markGameAsReleased(gameId);

      const after = getEnrichedGameById(gameId, 'default');
      expect(after?.isReleased).toBe(true);
    });
  });

  describe('updateReleaseStatus', () => {
    it('refreshes releaseDate string for an unreleased game', () => {
      // Repro of the Moonlight Peaks case: Steam tightened the date from
      // "later in 2026" to a concrete day, but the existing release check
      // never wrote the new string back.
      const gameId = seedGame(testDb, { steamAppId: 100, title: 'Moonlight Peaks' });
      upsertGameFromSteam({ steamAppId: 100, title: 'Moonlight Peaks', releaseDate: 'later in 2026', isReleased: false });
      seedUserGame(testDb, gameId, { isWishlisted: true });

      updateReleaseStatus(gameId, { isReleased: false, releaseDate: 'Jul 7, 2026' });

      const after = getEnrichedGameById(gameId, 'default');
      expect(after?.releaseDate).toBe('Jul 7, 2026');
      expect(after?.isReleased).toBeFalsy();
    });

    it('flips isReleased to true and updates the date on launch', () => {
      const gameId = seedGame(testDb, { steamAppId: 100, title: 'Launching Game' });
      upsertGameFromSteam({ steamAppId: 100, title: 'Launching Game', releaseDate: 'Coming Soon', isReleased: false });
      seedUserGame(testDb, gameId, { isWishlisted: true });

      updateReleaseStatus(gameId, { isReleased: true, releaseDate: 'Mar 15, 2026' });

      const after = getEnrichedGameById(gameId, 'default');
      expect(after?.isReleased).toBe(true);
      expect(after?.releaseDate).toBe('Mar 15, 2026');
    });

    it('never flips isReleased back to false', () => {
      // Guard: we only ever transition to released — never un-release a game.
      const gameId = seedGame(testDb, { steamAppId: 100, title: 'Released Game' });
      upsertGameFromSteam({ steamAppId: 100, title: 'Released Game', isReleased: true });
      seedUserGame(testDb, gameId, { isWishlisted: true });

      updateReleaseStatus(gameId, { isReleased: false, releaseDate: 'Jul 7, 2026' });

      const after = getEnrichedGameById(gameId, 'default');
      expect(after?.isReleased).toBe(true);
    });

    it('does not overwrite a known release date with an empty string', () => {
      // Guard against Steam blips returning { coming_soon: true, date: "" } —
      // the previously-known good string must survive.
      const gameId = seedGame(testDb, { steamAppId: 100, title: 'Moonlight Peaks' });
      upsertGameFromSteam({ steamAppId: 100, title: 'Moonlight Peaks', releaseDate: 'Jul 7, 2026', isReleased: false });
      seedUserGame(testDb, gameId, { isWishlisted: true });

      updateReleaseStatus(gameId, { isReleased: false, releaseDate: '' });

      const after = getEnrichedGameById(gameId, 'default');
      expect(after?.releaseDate).toBe('Jul 7, 2026');
    });
  });
});

// ============================================
// Metadata Refresh
// ============================================

describe('getGamesForMetadataRefresh', () => {
  it('orders NULL metadataLastUpdated first, then oldest-first', () => {
    const fresh = seedGame(testDb, { steamAppId: 1, title: 'Fresh', metadataLastUpdated: '2026-05-25T00:00:00.000Z' });
    const old = seedGame(testDb, { steamAppId: 2, title: 'Old', metadataLastUpdated: '2026-01-01T00:00:00.000Z' });
    const never = seedGame(testDb, { steamAppId: 3, title: 'Never' });
    seedUserGame(testDb, fresh, { isWishlisted: true });
    seedUserGame(testDb, old, { isWishlisted: true });
    seedUserGame(testDb, never, { isWishlisted: true });

    const result = getGamesForMetadataRefresh('default', 10);

    expect(result.map((g) => g.title)).toEqual(['Never', 'Old', 'Fresh']);
  });

  it('only returns wishlisted or owned games (not watchlist-only)', () => {
    const wishlisted = seedGame(testDb, { steamAppId: 1, title: 'Wishlisted' });
    const owned = seedGame(testDb, { steamAppId: 2, title: 'Owned' });
    const watchlistOnly = seedGame(testDb, { steamAppId: 3, title: 'Watchlist-only' });
    seedUserGame(testDb, wishlisted, { isWishlisted: true });
    seedUserGame(testDb, owned, { isOwned: true });
    seedUserGame(testDb, watchlistOnly, { isWatchlisted: true });

    const result = getGamesForMetadataRefresh('default', 10);

    expect(result.map((g) => g.title).sort()).toEqual(['Owned', 'Wishlisted']);
  });

  it('respects the batch size', () => {
    for (let i = 1; i <= 5; i++) {
      const id = seedGame(testDb, { steamAppId: i, title: `G${i}` });
      seedUserGame(testDb, id, { isWishlisted: true });
    }

    expect(getGamesForMetadataRefresh('default', 3)).toHaveLength(3);
  });

  it('scopes results to the requested user', () => {
    seedUser(testDb, { id: 'alice', email: 'a@example.com' });
    seedUser(testDb, { id: 'bob', email: 'b@example.com' });
    const aliceGame = seedGame(testDb, { steamAppId: 1, title: 'Alice Game' });
    const bobGame = seedGame(testDb, { steamAppId: 2, title: 'Bob Game' });
    seedUserGame(testDb, aliceGame, { userId: 'alice', isWishlisted: true });
    seedUserGame(testDb, bobGame, { userId: 'bob', isWishlisted: true });

    const result = getGamesForMetadataRefresh('alice', 10);

    expect(result.map((g) => g.title)).toEqual(['Alice Game']);
  });
});

describe('updateGameMetadata', () => {
  function readGame(gameId: number) {
    return testDb.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  }

  it('always stamps metadataLastUpdated', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Stamped' });

    updateGameMetadata(gameId, {});

    const after = readGame(gameId);
    expect(after?.metadataLastUpdated).toBeTruthy();
    expect(() => new Date(after!.metadataLastUpdated!).toISOString()).not.toThrow();
  });

  it('writes review fields and isEarlyAccess', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Early Access Game' });

    updateGameMetadata(gameId, {
      isEarlyAccess: true,
      reviewScore: 85,
      reviewCount: 1234,
      reviewDescription: 'Very Positive',
    });

    const after = readGame(gameId);
    expect(after?.isEarlyAccess).toBe(true);
    expect(after?.reviewScore).toBe(85);
    expect(after?.reviewCount).toBe(1234);
    expect(after?.reviewDescription).toBe('Very Positive');
  });

  it('flips isEarlyAccess from true to false (EA graduation path)', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Graduating', isEarlyAccess: true });

    updateGameMetadata(gameId, { isEarlyAccess: false });

    expect(getEarlyAccessSnapshot(gameId)).toBe(false);
  });

  it('does not overwrite a known release date with an empty string', () => {
    // Same guard as updateReleaseStatus — a Steam blip returning "" must not
    // wipe a previously-known good date.
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Moonlight Peaks' });
    upsertGameFromSteam({ steamAppId: 1, title: 'Moonlight Peaks', releaseDate: 'Jul 7, 2026', isReleased: false });

    updateGameMetadata(gameId, { releaseDate: '' });

    const after = getEnrichedGameById(gameId, 'default');
    expect(after?.releaseDate).toBe('Jul 7, 2026');
  });

  it('never flips isReleased back to false', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Released' });
    upsertGameFromSteam({ steamAppId: 1, title: 'Released', isReleased: true });

    updateGameMetadata(gameId, { isReleased: false });

    const after = getEnrichedGameById(gameId, 'default');
    expect(after?.isReleased).toBe(true);
  });
});

describe('getEarlyAccessSnapshot', () => {
  it('returns the current isEarlyAccess value', () => {
    const ea = seedGame(testDb, { steamAppId: 1, title: 'EA', isEarlyAccess: true });
    const released = seedGame(testDb, { steamAppId: 2, title: 'Released', isEarlyAccess: false });
    const unknown = seedGame(testDb, { steamAppId: 3, title: 'Unknown' });

    expect(getEarlyAccessSnapshot(ea)).toBe(true);
    expect(getEarlyAccessSnapshot(released)).toBe(false);
    expect(getEarlyAccessSnapshot(unknown)).toBeNull();
  });

  it('returns null for a missing game', () => {
    expect(getEarlyAccessSnapshot(99999)).toBeNull();
  });
});

// ============================================
// Additional getEnrichedGames filters
// ============================================

describe('additional getEnrichedGames filters', () => {
  beforeEach(() => {
    const g1 = seedGame(testDb, { steamAppId: 100, title: 'On Sale Game' });
    const g2 = seedGame(testDb, { steamAppId: 200, title: 'Full Price Game' });
    const g3 = seedGame(testDb, { steamAppId: 300, title: 'Cheap Game' });

    seedUserGame(testDb, g1, { isOwned: true, personalInterest: 5 });
    seedUserGame(testDb, g2, { isOwned: true, personalInterest: 2 });
    seedUserGame(testDb, g3, { isOwned: true, personalInterest: 4 });

    // g1: discounted
    seedPriceSnapshot(testDb, g1, { priceCurrent: 9.99, priceRegular: 19.99, discountPercent: 50 });
    // g2: no discount
    seedPriceSnapshot(testDb, g2, { priceCurrent: 59.99, priceRegular: 59.99, discountPercent: 0 });
    // g3: small discount, cheap price
    seedPriceSnapshot(testDb, g3, { priceCurrent: 2.99, priceRegular: 4.99, discountPercent: 40 });
  });

  it('onSale: true only returns games with discountPercent > 0', () => {
    const result = getEnrichedGames({ onSale: true }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(2);
    const titles = result.games.map(g => g.title);
    expect(titles).toContain('On Sale Game');
    expect(titles).toContain('Cheap Game');
    expect(titles).not.toContain('Full Price Game');
  });

  it('maxPrice only returns games at or below price', () => {
    const result = getEnrichedGames({ maxPrice: 5.00 }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(1);
    expect(result.games[0].title).toBe('Cheap Game');
  });

  it('minInterest only returns games with personalInterest >= threshold', () => {
    const result = getEnrichedGames({ minInterest: 4 }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(2);
    const titles = result.games.map(g => g.title);
    expect(titles).toContain('On Sale Game');
    expect(titles).toContain('Cheap Game');
    expect(titles).not.toContain('Full Price Game');
  });
});

describe('getEnrichedGames earlyAccess filter', () => {
  beforeEach(() => {
    const ea = seedGame(testDb, { steamAppId: 100, title: 'EA Game', isEarlyAccess: true });
    const released = seedGame(testDb, { steamAppId: 200, title: 'Released Game', isEarlyAccess: false });
    const unknown = seedGame(testDb, { steamAppId: 300, title: 'Unknown Game' });

    seedUserGame(testDb, ea, { isOwned: true });
    seedUserGame(testDb, released, { isOwned: true });
    seedUserGame(testDb, unknown, { isOwned: true });
  });

  it('earlyAccess=true returns only games with isEarlyAccess=true', () => {
    const result = getEnrichedGames({ earlyAccess: true }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(1);
    expect(result.games[0].title).toBe('EA Game');
  });

  it('earlyAccess=false returns games with isEarlyAccess=false OR NULL', () => {
    const result = getEnrichedGames({ earlyAccess: false }, undefined, undefined, 'default');
    expect(result.games).toHaveLength(2);
    const titles = result.games.map(g => g.title).sort();
    expect(titles).toEqual(['Released Game', 'Unknown Game']);
  });

  it('earlyAccess=undefined returns all games', () => {
    const result = getEnrichedGames({}, undefined, undefined, 'default');
    expect(result.games).toHaveLength(3);
  });

  it('exposes isEarlyAccess on returned rows', () => {
    const result = getEnrichedGames({}, undefined, undefined, 'default');
    const byTitle = new Map(result.games.map(g => [g.title, g]));
    expect(byTitle.get('EA Game')?.isEarlyAccess).toBe(true);
    expect(byTitle.get('Released Game')?.isEarlyAccess).toBe(false);
    expect(byTitle.get('Unknown Game')?.isEarlyAccess).toBeUndefined();
  });
});

// ============================================
// getAutoAlertCandidates (auto-alert gating query)
// ============================================

describe('getAutoAlertCandidates', () => {
  // Seed a fully-qualifying candidate: wishlisted, released, ATL, deal_score 90.
  function seedCandidate(
    opts: {
      title: string;
      steamAppId: number;
      userId?: string;
      isWishlisted?: boolean;
      isReleased?: boolean;
      autoAlertDisabled?: boolean;
      dealScore?: number;
      priceCurrent?: number;
      isHistoricalLow?: boolean;
      snapshotDate?: string;
      historicalLowPrice?: number;
    },
  ): number {
    const gameId = seedGame(testDb, {
      steamAppId: opts.steamAppId,
      title: opts.title,
      isReleased: opts.isReleased ?? true,
    });
    seedUserGame(testDb, gameId, {
      userId: opts.userId ?? 'default',
      isWishlisted: opts.isWishlisted ?? true,
      autoAlertDisabled: opts.autoAlertDisabled ?? false,
    });
    seedPriceSnapshot(testDb, gameId, {
      isHistoricalLow: opts.isHistoricalLow ?? true,
      dealScore: opts.dealScore ?? 90,
      priceCurrent: opts.priceCurrent ?? 9.99,
      historicalLowPrice: opts.historicalLowPrice ?? 9.99,
      snapshotDate: opts.snapshotDate ?? '2026-05-15',
    });
    return gameId;
  }

  it('(a) surfaces only wishlisted, released, non-disabled games at historical low', () => {
    seedCandidate({ title: 'Qualifies', steamAppId: 1 });
    // not wishlisted
    seedCandidate({ title: 'Not Wishlisted', steamAppId: 2, isWishlisted: false });
    // unreleased
    seedCandidate({ title: 'Unreleased', steamAppId: 3, isReleased: false });
    // not at historical low
    seedCandidate({ title: 'Not ATL', steamAppId: 4, isHistoricalLow: false });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates.map((c) => c.title)).toEqual(['Qualifies']);
  });

  it('(b) respects minDealScore, but price_current = 0 (free) bypasses it', () => {
    seedCandidate({ title: 'Below Threshold', steamAppId: 1, dealScore: 40 });
    seedCandidate({ title: 'Free Game', steamAppId: 2, dealScore: 10, priceCurrent: 0 });
    seedCandidate({ title: 'Above Threshold', steamAppId: 3, dealScore: 80 });

    const candidates = getAutoAlertCandidates('default', 70);
    expect(candidates.map((c) => c.title).sort()).toEqual(['Above Threshold', 'Free Game']);
  });

  it('(c) excludes games that already have a price_alerts row (NOT EXISTS guard)', () => {
    const withAlert = seedCandidate({ title: 'Has Manual Alert', steamAppId: 1 });
    seedPriceAlert(testDb, withAlert, { userId: 'default' });
    seedCandidate({ title: 'No Alert', steamAppId: 2 });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates.map((c) => c.title)).toEqual(['No Alert']);
  });

  it('(c) the NOT EXISTS guard is scoped per-user — another user\'s alert does not exclude', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Shared Game', isReleased: true });
    seedUserGame(testDb, gameId, { userId: 'default', isWishlisted: true });
    seedPriceSnapshot(testDb, gameId, { isHistoricalLow: true, dealScore: 90 });
    // A different user holds an alert for the same game.
    seedPriceAlert(testDb, gameId, { userId: 'other-user' });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates.map((c) => c.title)).toEqual(['Shared Game']);
  });

  it('(d) treats auto_alert_disabled = NULL as enabled', () => {
    const gameId = seedCandidate({ title: 'Null Flag', steamAppId: 1 });
    testDb.run(sql`UPDATE user_games SET auto_alert_disabled = NULL WHERE game_id = ${gameId}`);
    // sanity: an explicitly-disabled game must NOT surface
    seedCandidate({ title: 'Disabled', steamAppId: 2, autoAlertDisabled: true });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates.map((c) => c.title)).toEqual(['Null Flag']);
  });

  it('(e) prevHistoricalLowPrice resolves to the immediately-prior snapshot', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Two Snapshots', isReleased: true });
    seedUserGame(testDb, gameId, { userId: 'default', isWishlisted: true });
    // Earlier snapshot: ATL was 19.99
    seedPriceSnapshot(testDb, gameId, {
      snapshotDate: '2026-05-01',
      historicalLowPrice: 19.99,
      dealScore: 60,
      isHistoricalLow: true,
    });
    // Latest snapshot: ATL dropped to 9.99 — this is the candidate row
    seedPriceSnapshot(testDb, gameId, {
      snapshotDate: '2026-05-02',
      historicalLowPrice: 9.99,
      dealScore: 90,
      isHistoricalLow: true,
    });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].historicalLowPrice).toBe(9.99);
    expect(candidates[0].prevHistoricalLowPrice).toBe(19.99);
  });

  it('selects the latest snapshot by snapshot_date DESC, then deal_score DESC', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Same-Day Tie', isReleased: true });
    seedUserGame(testDb, gameId, { userId: 'default', isWishlisted: true });
    // Two snapshots on the same date: the higher deal_score is the "latest".
    seedPriceSnapshot(testDb, gameId, {
      snapshotDate: '2026-05-10',
      store: 'steam',
      dealScore: 55,
      isHistoricalLow: true,
    });
    seedPriceSnapshot(testDb, gameId, {
      snapshotDate: '2026-05-10',
      store: 'gog',
      dealScore: 88,
      isHistoricalLow: true,
    });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dealScore).toBe(88);
  });

  it('scopes candidates to the requested user', () => {
    seedCandidate({ title: 'Mine', steamAppId: 1, userId: 'default' });
    seedCandidate({ title: 'Theirs', steamAppId: 2, userId: 'other-user' });

    const candidates = getAutoAlertCandidates('default', 50);
    expect(candidates.map((c) => c.title)).toEqual(['Mine']);
  });
});

// ============================================
// cascadePurchaseCleanup + getPreOwnershipState (ownership transition)
// ============================================

describe('cascadePurchaseCleanup', () => {
  it('deactivates alerts, clears wishlist flags, and stamps wishlistRemovedAt for the passed games only', () => {
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'Bought' });
    const g2 = seedGame(testDb, { steamAppId: 2, title: 'Still Wishlisted' });
    const g3 = seedGame(testDb, { steamAppId: 3, title: 'Other User Game' });

    seedUserGame(testDb, g1, { userId: 'userA', isWishlisted: true, isWatchlisted: true });
    seedUserGame(testDb, g2, { userId: 'userA', isWishlisted: true });
    seedUserGame(testDb, g3, { userId: 'userB', isWishlisted: true });
    seedPriceAlert(testDb, g1, { userId: 'userA', isActive: true });
    seedPriceAlert(testDb, g2, { userId: 'userA', isActive: true });
    seedPriceAlert(testDb, g3, { userId: 'userB', isActive: true });

    cascadePurchaseCleanup([g1], 'userA');

    const rows = testDb.select().from(schema.userGames).all();
    const byGame = new Map(rows.map((r) => [r.gameId, r]));
    // g1 cleaned up
    expect(byGame.get(g1)?.isWishlisted).toBe(false);
    expect(byGame.get(g1)?.isWatchlisted).toBe(false);
    expect(byGame.get(g1)?.wishlistRemovedAt).not.toBeNull();
    // g2 (same user, not passed) untouched
    expect(byGame.get(g2)?.isWishlisted).toBe(true);
    expect(byGame.get(g2)?.wishlistRemovedAt).toBeNull();
    // g3 (other user) untouched
    expect(byGame.get(g3)?.isWishlisted).toBe(true);

    const alerts = testDb.select().from(schema.priceAlerts).all();
    const alertByGame = new Map(alerts.map((a) => [a.gameId, a]));
    expect(alertByGame.get(g1)?.isActive).toBe(false); // deactivated
    expect(alertByGame.get(g2)?.isActive).toBe(true); // untouched
    expect(alertByGame.get(g3)?.isActive).toBe(true); // other user untouched
  });

  it('clears wishlistedLocally on the purchased games', () => {
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'Hoard-only then bought' });
    seedUserGame(testDb, g1, { userId: 'userA', isWishlisted: true, wishlistedLocally: true });

    cascadePurchaseCleanup([g1], 'userA');

    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, g1)).get();
    expect(row?.isWishlisted).toBe(false);
    expect(row?.wishlistedLocally).toBe(false);
  });

  it('scopes by userId — another user\'s row for the SAME game is untouched', () => {
    const shared = seedGame(testDb, { steamAppId: 1, title: 'Shared Game' });
    // Both users hold the same game wishlisted, each with an active alert.
    seedUserGame(testDb, shared, { userId: 'userA', isWishlisted: true });
    seedUserGame(testDb, shared, { userId: 'userB', isWishlisted: true });
    seedPriceAlert(testDb, shared, { userId: 'userA', isActive: true });
    seedPriceAlert(testDb, shared, { userId: 'userB', isActive: true });

    cascadePurchaseCleanup([shared], 'userA');

    const rows = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, shared)).all();
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    // userA bought it → cleaned up
    expect(byUser.get('userA')?.isWishlisted).toBe(false);
    expect(byUser.get('userA')?.wishlistRemovedAt).not.toBeNull();
    // userB still wants it → must be left alone (would break if userId filter dropped)
    expect(byUser.get('userB')?.isWishlisted).toBe(true);
    expect(byUser.get('userB')?.wishlistRemovedAt).toBeNull();

    const alerts = testDb.select().from(schema.priceAlerts).where(eq(schema.priceAlerts.gameId, shared)).all();
    const alertByUser = new Map(alerts.map((a) => [a.userId, a]));
    expect(alertByUser.get('userA')?.isActive).toBe(false);
    expect(alertByUser.get('userB')?.isActive).toBe(true);
  });

  it('is a no-op for an empty gameIds array', () => {
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'Untouched' });
    seedUserGame(testDb, g1, { userId: 'userA', isWishlisted: true });
    seedPriceAlert(testDb, g1, { userId: 'userA', isActive: true });

    cascadePurchaseCleanup([], 'userA');

    const row = testDb.select().from(schema.userGames).where(eq(schema.userGames.gameId, g1)).get();
    expect(row?.isWishlisted).toBe(true);
    expect(row?.wishlistRemovedAt).toBeNull();
  });
});

describe('getPreOwnershipState', () => {
  it('reports wasOwned from is_owned and wasWishlisted only when not yet removed', () => {
    const owned = seedGame(testDb, { steamAppId: 1, title: 'Owned' });
    const wishlisted = seedGame(testDb, { steamAppId: 2, title: 'Wishlisted' });
    const removed = seedGame(testDb, { steamAppId: 3, title: 'Removed Wishlist' });

    seedUserGame(testDb, owned, { userId: 'userA', isOwned: true, isWishlisted: false });
    seedUserGame(testDb, wishlisted, { userId: 'userA', isWishlisted: true });
    seedUserGame(testDb, removed, {
      userId: 'userA',
      isWishlisted: true,
      wishlistRemovedAt: '2026-01-01T00:00:00.000Z',
    });

    const state = getPreOwnershipState([owned, wishlisted, removed], 'userA');
    const byGame = new Map(state.map((s) => [s.gameId, s]));
    expect(byGame.get(owned)).toMatchObject({ wasOwned: true, wasWishlisted: false });
    expect(byGame.get(wishlisted)).toMatchObject({ wasOwned: false, wasWishlisted: true });
    // currently wishlisted but already removed → not counted as wishlisted
    expect(byGame.get(removed)).toMatchObject({ wasOwned: false, wasWishlisted: false });
  });

  it('returns an empty array for empty input', () => {
    expect(getPreOwnershipState([], 'userA')).toEqual([]);
  });

  it('scopes by userId', () => {
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'A Game' });
    seedUserGame(testDb, g1, { userId: 'userA', isOwned: true });
    seedUserGame(testDb, g1, { userId: 'userB', isWishlisted: true });

    const state = getPreOwnershipState([g1], 'userB');
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ wasOwned: false, wasWishlisted: true });
  });
});

// ============================================
// getGamesForTriage (four-way view selector)
// ============================================

describe('getGamesForTriage', () => {
  beforeEach(() => {
    // owned + played + unrated → qualifies for 'value'
    const ownedPlayed = seedGame(testDb, { steamAppId: 1, title: 'Owned Played', hltbMain: 10 });
    seedUserGame(testDb, ownedPlayed, { isOwned: true, playtimeMinutes: 600 });
    // owned but never played, has hltb
    const ownedUnplayed = seedGame(testDb, { steamAppId: 2, title: 'Owned Unplayed', hltbMain: 5 });
    seedUserGame(testDb, ownedUnplayed, { isOwned: true, playtimeMinutes: 0 });
    // wishlisted, missing hltb
    const wishlistedNoHltb = seedGame(testDb, { steamAppId: 3, title: 'Wishlisted NoHLTB' });
    seedUserGame(testDb, wishlistedNoHltb, { isWishlisted: true });
    // ignored — must never surface
    const ignored = seedGame(testDb, { steamAppId: 4, title: 'Ignored', hltbMain: 8 });
    seedUserGame(testDb, ignored, { isOwned: true, isIgnored: true, playtimeMinutes: 300 });
  });

  it('view=library returns owned games (excluding ignored)', () => {
    const titles = getGamesForTriage('library', 'default').map((g) => g.title).sort();
    expect(titles).toEqual(['Owned Played', 'Owned Unplayed']);
  });

  it('view=wishlist returns wishlisted games', () => {
    const titles = getGamesForTriage('wishlist', 'default').map((g) => g.title);
    expect(titles).toEqual(['Wishlisted NoHLTB']);
  });

  it('view=missing-hltb returns games with null hltb_main', () => {
    const titles = getGamesForTriage('missing-hltb', 'default').map((g) => g.title);
    expect(titles).toEqual(['Wishlisted NoHLTB']);
  });

  it('view=value returns owned + played + unrated games only', () => {
    const titles = getGamesForTriage('value', 'default').map((g) => g.title);
    expect(titles).toEqual(['Owned Played']);
  });

  it('undefined view returns all non-ignored games', () => {
    const titles = getGamesForTriage(undefined, 'default').map((g) => g.title).sort();
    expect(titles).toEqual(['Owned Played', 'Owned Unplayed', 'Wishlisted NoHLTB']);
  });
});

// ============================================
// getDealScoreDistribution (chart bucketing)
// ============================================

describe('getDealScoreDistribution', () => {
  // getScoringConfig has a 60s Date.now()-keyed cache; advance past it each test.
  let timeOffset = 0;
  const realDateNow = Date.now;
  beforeEach(() => {
    timeOffset += 61_000;
    vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + timeOffset);
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array when the user has no games', () => {
    expect(getDealScoreDistribution('default')).toEqual([]);
  });

  it('returns all five buckets in canonical order, summing only priced games', () => {
    // two priced owned games + one free game (excluded from buckets)
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'Priced A', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, g1, { isOwned: true, personalInterest: 4 });
    seedPriceSnapshot(testDb, g1, { priceCurrent: 9.99, priceRegular: 39.99, historicalLowPrice: 9.99 });

    const g2 = seedGame(testDb, { steamAppId: 2, title: 'Priced B', reviewScore: 50, hltbMain: 2 });
    seedUserGame(testDb, g2, { isOwned: true, personalInterest: 2 });
    seedPriceSnapshot(testDb, g2, { priceCurrent: 59.99, priceRegular: 59.99, historicalLowPrice: 10 });

    const g3 = seedGame(testDb, { steamAppId: 3, title: 'Free', reviewScore: 80, hltbMain: 5 });
    seedUserGame(testDb, g3, { isOwned: true });
    seedPriceSnapshot(testDb, g3, { priceCurrent: 0, priceRegular: 0, historicalLowPrice: 0 });

    const dist = getDealScoreDistribution('default');
    expect(dist.map((d) => d.bucket)).toEqual(['Poor', 'Okay', 'Good', 'Great', 'Excellent']);
    const total = dist.reduce((sum, d) => sum + d.count, 0);
    // free game excluded → only the two priced games are bucketed
    expect(total).toBe(2);
  });

  it('excludes wishlist-removed games from the pool', () => {
    const g1 = seedGame(testDb, { steamAppId: 1, title: 'Removed', reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, g1, {
      isWishlisted: true,
      wishlistRemovedAt: '2026-01-01T00:00:00.000Z',
    });
    seedPriceSnapshot(testDb, g1, { priceCurrent: 9.99, priceRegular: 39.99 });

    expect(getDealScoreDistribution('default')).toEqual([]);
  });
});
