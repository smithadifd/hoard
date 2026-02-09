/**
 * Test database utilities.
 *
 * Creates isolated in-memory SQLite databases with schema applied
 * for integration testing of query functions.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * Schema DDL matching the production ensureSchema() from index.ts,
 * plus columns added via migrations.
 */
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_app_id INTEGER NOT NULL UNIQUE,
    itad_game_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    header_image_url TEXT,
    capsule_image_url TEXT,
    release_date TEXT,
    developer TEXT,
    publisher TEXT,
    review_score INTEGER,
    review_count INTEGER,
    review_description TEXT,
    hltb_id INTEGER,
    hltb_main REAL,
    hltb_main_extra REAL,
    hltb_completionist REAL,
    hltb_last_updated TEXT,
    review_last_updated TEXT,
    is_coop INTEGER DEFAULT 0,
    is_multiplayer INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tag_name_type_idx ON tags (name, type);

  CREATE TABLE IF NOT EXISTS game_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS game_tag_idx ON game_tags (game_id, tag_id);

  CREATE TABLE IF NOT EXISTS user_games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    is_owned INTEGER DEFAULT 0,
    is_wishlisted INTEGER DEFAULT 0,
    is_watchlisted INTEGER DEFAULT 0,
    is_ignored INTEGER DEFAULT 0,
    playtime_minutes INTEGER DEFAULT 0,
    playtime_recent_minutes INTEGER DEFAULT 0,
    last_played TEXT,
    personal_interest INTEGER DEFAULT 3,
    interest_rated_at TEXT,
    price_threshold REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS user_game_idx ON user_games (user_id, game_id);

  CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    store TEXT NOT NULL,
    price_current REAL NOT NULL,
    price_regular REAL NOT NULL,
    discount_percent INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    url TEXT,
    is_historical_low INTEGER DEFAULT 0,
    historical_low_price REAL,
    deal_score INTEGER,
    snapshot_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    target_price REAL,
    notify_on_all_time_low INTEGER DEFAULT 1,
    notify_on_threshold INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    last_notified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS alert_user_game_idx ON price_alerts (user_id, game_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    items_processed INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
`;

export type TestDb = ReturnType<typeof drizzle>;

/**
 * Create a fresh in-memory SQLite database with all tables.
 * Returns the Drizzle ORM instance.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = true');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

/**
 * Seed a game into the test database. Returns the game ID.
 */
export function seedGame(
  db: TestDb,
  overrides: Partial<typeof schema.games.$inferInsert> & { steamAppId: number; title: string }
): number {
  const result = db
    .insert(schema.games)
    .values({
      steamAppId: overrides.steamAppId,
      title: overrides.title,
      headerImageUrl: overrides.headerImageUrl ?? `https://cdn.steam/apps/${overrides.steamAppId}/header.jpg`,
      description: overrides.description,
      reviewScore: overrides.reviewScore,
      reviewCount: overrides.reviewCount,
      reviewDescription: overrides.reviewDescription,
      hltbMain: overrides.hltbMain,
      hltbMainExtra: overrides.hltbMainExtra,
      hltbCompletionist: overrides.hltbCompletionist,
      isCoop: overrides.isCoop,
      isMultiplayer: overrides.isMultiplayer,
      developer: overrides.developer,
      publisher: overrides.publisher,
      releaseDate: overrides.releaseDate,
    })
    .returning({ id: schema.games.id })
    .get();
  return result.id;
}

/**
 * Seed a user_games record. Returns the user_game ID.
 */
export function seedUserGame(
  db: TestDb,
  gameId: number,
  overrides: Partial<typeof schema.userGames.$inferInsert> = {}
): number {
  const result = db
    .insert(schema.userGames)
    .values({
      userId: 'default',
      gameId,
      isOwned: overrides.isOwned ?? false,
      isWishlisted: overrides.isWishlisted ?? false,
      isWatchlisted: overrides.isWatchlisted ?? false,
      isIgnored: overrides.isIgnored ?? false,
      playtimeMinutes: overrides.playtimeMinutes ?? 0,
      personalInterest: overrides.personalInterest ?? 3,
      priceThreshold: overrides.priceThreshold,
      notes: overrides.notes,
    })
    .returning({ id: schema.userGames.id })
    .get();
  return result.id;
}

/**
 * Seed a price snapshot. Returns the snapshot ID.
 */
export function seedPriceSnapshot(
  db: TestDb,
  gameId: number,
  overrides: Partial<typeof schema.priceSnapshots.$inferInsert> = {}
): number {
  const result = db
    .insert(schema.priceSnapshots)
    .values({
      gameId,
      store: overrides.store ?? 'steam',
      priceCurrent: overrides.priceCurrent ?? 19.99,
      priceRegular: overrides.priceRegular ?? 39.99,
      discountPercent: overrides.discountPercent ?? 50,
      currency: overrides.currency ?? 'USD',
      url: overrides.url,
      isHistoricalLow: overrides.isHistoricalLow ?? false,
      historicalLowPrice: overrides.historicalLowPrice,
      dealScore: overrides.dealScore,
      snapshotDate: overrides.snapshotDate ?? new Date().toISOString().split('T')[0],
    })
    .returning({ id: schema.priceSnapshots.id })
    .get();
  return result.id;
}

/**
 * Seed a price alert. Returns the alert ID.
 */
export function seedPriceAlert(
  db: TestDb,
  gameId: number,
  overrides: Partial<typeof schema.priceAlerts.$inferInsert> = {}
): number {
  const result = db
    .insert(schema.priceAlerts)
    .values({
      userId: 'default',
      gameId,
      targetPrice: overrides.targetPrice,
      notifyOnAllTimeLow: overrides.notifyOnAllTimeLow ?? true,
      notifyOnThreshold: overrides.notifyOnThreshold ?? true,
      isActive: overrides.isActive ?? true,
      lastNotifiedAt: overrides.lastNotifiedAt,
    })
    .returning({ id: schema.priceAlerts.id })
    .get();
  return result.id;
}

/**
 * Seed a setting.
 */
export function seedSetting(db: TestDb, key: string, value: string): void {
  db.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
}
