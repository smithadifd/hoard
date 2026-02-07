import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import * as schema from './schema';
import { getConfig } from '../config';

let db: ReturnType<typeof createDb> | null = null;

function ensureSchema(sqlite: BetterSqlite3.Database) {
  // Auto-create tables if they don't exist (safe for production — IF NOT EXISTS is a no-op)
  sqlite.exec(`
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
  `);
}

function createDb() {
  const config = getConfig();
  const sqlite = new Database(config.databaseUrl);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = 1000000000'); // 1GB
  sqlite.pragma('foreign_keys = true');
  sqlite.pragma('temp_store = memory');

  ensureSchema(sqlite);

  return drizzle(sqlite, { schema });
}

export function getDb() {
  if (!db) {
    db = createDb();
  }
  return db;
}

export type Database = ReturnType<typeof getDb>;
export { schema };
