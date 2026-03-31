import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { createTestDb, seedGame, seedUserGame, seedPriceSnapshot, seedPriceAlert, seedSetting, seedUser } from './test-helpers';
import type { TestDb } from './test-helpers';

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
  upsertGameFromSteam,
  getExistingGamesByAppIds,
  upsertUserGame,
  updateUserGame,
  upsertTags,
  getEnrichedGames,
  getEnrichedGameById,
  getDashboardStats,
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
  getRecentSyncStats,
  getLastSuccessfulSyncBySource,
  getFirstUserId,
  getUnreleasedCount,
  markGameAsReleased,
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

  it('generates header image URL if not provided', () => {
    const id = upsertGameFromSteam({ steamAppId: 440, title: 'TF2' });
    const game = getEnrichedGameById(id, 'default');
    expect(game?.headerImageUrl).toContain('440');
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
