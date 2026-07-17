import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import * as schema from './schema';
import { getConfig } from '../config';

let db: ReturnType<typeof createDb> | null = null;

/**
 * Better Auth tables (snake_case columns, integer millisecond timestamps).
 *
 * Kept in one shared constant so the initial-create path (`ensureSchema`) and
 * the legacy-migration recreate path (`recreateAuthTables`) use a single source
 * of truth and can never drift apart.
 */
const AUTH_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );

  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    id_token TEXT,
    password TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );

  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
`;

/** The four Better Auth tables, ordered children-first for safe DROP. */
const AUTH_TABLES = ['verification', 'account', 'session', 'user'] as const;

/**
 * Opt-in env flag that permits the DESTRUCTIVE reset of a legacy camelCase auth
 * schema that still contains data. When set to `'true'`, a timestamped backup of
 * the database file is taken before the tables are dropped. Without it, a
 * populated legacy schema fails loud instead of silently destroying user data.
 */
const ALLOW_AUTH_TABLE_RESET_ENV = 'HOARD_ALLOW_AUTH_TABLE_RESET';

function tableExists(sqlite: BetterSqlite3.Database, table: string): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/**
 * Total row count across all auth tables. A missing table counts as 0 rows.
 * A genuine COUNT failure is allowed to propagate (halt) rather than be
 * swallowed — under-counting here could mask real data and lead to a drop.
 */
function countAuthRows(sqlite: BetterSqlite3.Database): number {
  let total = 0;
  for (const table of AUTH_TABLES) {
    if (!tableExists(sqlite, table)) continue;
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
      count: number;
    };
    total += row.count;
  }
  return total;
}

/** Drop (children-first) and recreate the auth tables with the snake_case schema. */
function recreateAuthTables(sqlite: BetterSqlite3.Database): void {
  for (const table of AUTH_TABLES) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  sqlite.exec(AUTH_TABLES_DDL);
}

/**
 * Build the fail-loud, actionable error thrown when a legacy camelCase auth
 * schema still holds data. Shared by the default refusal and the gated path's
 * "backup could not be taken" refusal so the guidance is identical.
 */
function legacyAuthDataLossError(authRowCount: number, extraReason?: string): Error {
  const lines: string[] = [
    `Legacy camelCase auth schema detected (\`user.emailVerified\` present) with ` +
      `${authRowCount} existing row(s) across ${AUTH_TABLES.join('/')}.`,
  ];
  if (extraReason) {
    lines.push(extraReason);
  }
  lines.push(
    'Refusing to auto-drop the auth tables — that would permanently destroy user',
    'accounts, password credentials, active sessions and verification tokens with no backup.',
    '',
    'Resolve one of two ways, then restart:',
    '  1. Back up the database, then migrate the auth tables from camelCase to snake_case',
    '     columns yourself (rename the columns, or copy the rows into fresh snake_case tables); OR',
    `  2. To intentionally DISCARD the existing auth data, restart with ` +
      `${ALLOW_AUTH_TABLE_RESET_ENV}=true`,
    '     — a timestamped database backup is taken automatically before the reset.'
  );
  return new Error(lines.join('\n'));
}

/**
 * Take a consistent, timestamped snapshot of the database file before a
 * destructive auth-table reset. Uses `VACUUM INTO` (synchronous, WAL-safe).
 *
 * A successful backup is a HARD PRECONDITION for the reset. If one cannot be
 * taken — an in-memory database (no file to copy), a missing path, or a failing
 * `VACUUM INTO` — this THROWS, so the caller refuses the reset (fail closed)
 * rather than dropping populated auth data unprotected. Returns the backup file
 * path on success.
 */
function backupBeforeAuthReset(sqlite: BetterSqlite3.Database): string {
  if (sqlite.memory || !sqlite.name) {
    throw new Error('database is in-memory — there is no file to back up');
  }
  const dbPath = sqlite.name;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.auth-reset-backup-${stamp}`;
  // VACUUM INTO writes a clean, consistent copy of the live DB to a new file.
  // Throws if the target exists or cannot be written — the caller fails closed.
  sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  return backupPath;
}

/**
 * Reconcile the Better Auth tables when a *legacy camelCase* schema is found.
 *
 * SAFETY-CRITICAL. This replaces an older implementation that unconditionally
 * dropped user/session/account/verification whenever the legacy `emailVerified`
 * column was detected — an implicit, un-backed-up data-loss path.
 *
 * How the three cases are distinguished (this is the crux):
 *
 *  - Fresh / already-snake_case DB: `ensureSchema` created (or found) the auth
 *    tables with snake_case columns, so `user.emailVerified` does not exist.
 *    This function is a no-op — normal boot and fresh bootstrap are never
 *    affected, so removing the drop cannot break a legitimate fresh DB.
 *  - Legacy camelCase tables that are EMPTY: there is nothing to lose, so we
 *    drop and recreate them as snake_case. This keeps a legitimate legacy
 *    bootstrap (e.g. a dev DB that only ever held the old, empty tables) working.
 *  - Legacy camelCase tables WITH DATA: dropping them would permanently destroy
 *    real user accounts, password credentials, sessions and verification tokens.
 *    We REFUSE and throw a loud, actionable error — we NEVER drop populated
 *    tables. An operator who knowingly wants to discard the old auth data can
 *    set HOARD_ALLOW_AUTH_TABLE_RESET=true, in which case a timestamped backup
 *    is taken before the reset. That backup is a HARD precondition: if it cannot
 *    be taken (e.g. an in-memory DB, or VACUUM INTO fails), the reset is refused
 *    (fail closed) — populated auth data is never dropped without a backup.
 */
export function reconcileLegacyAuthSchema(sqlite: BetterSqlite3.Database): void {
  const legacyColumn = sqlite
    .prepare(`SELECT name FROM pragma_table_info('user') WHERE name = 'emailVerified'`)
    .get() as { name: string } | undefined;

  if (!legacyColumn) {
    // Snake_case (current) schema, or no user table yet — nothing to migrate.
    return;
  }

  const authRowCount = countAuthRows(sqlite);

  if (authRowCount === 0) {
    // Empty legacy tables — safe to convert to snake_case, no data at risk.
    recreateAuthTables(sqlite);
    return;
  }

  const resetAllowed = process.env[ALLOW_AUTH_TABLE_RESET_ENV] === 'true';

  if (!resetAllowed) {
    throw legacyAuthDataLossError(authRowCount);
  }

  // Explicit, operator-gated, destructive reset. A successful backup is a HARD
  // precondition: if we cannot back up the data first (in-memory DB, or the
  // VACUUM INTO fails), REFUSE the reset (fail closed) so populated auth data is
  // never dropped unprotected — even under the override flag.
  let backupPath: string;
  try {
    backupPath = backupBeforeAuthReset(sqlite);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw legacyAuthDataLossError(
      authRowCount,
      `${ALLOW_AUTH_TABLE_RESET_ENV}=true was set, but the required pre-reset backup ` +
        `could not be taken (${reason}); refusing to drop populated auth data without a backup.`
    );
  }

  console.warn(
    `[db] ${ALLOW_AUTH_TABLE_RESET_ENV}=true — resetting legacy auth tables; ` +
      `${authRowCount} row(s) will be discarded (backup written to ${backupPath}).`
  );
  recreateAuthTables(sqlite);
}

export function ensureSchema(sqlite: BetterSqlite3.Database) {
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
      hltb_manual INTEGER DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS ug_owned_idx ON user_games (user_id, is_owned);
    CREATE INDEX IF NOT EXISTS ug_wishlisted_idx ON user_games (user_id, is_wishlisted);
    CREATE INDEX IF NOT EXISTS ug_watchlisted_idx ON user_games (user_id, is_watchlisted);

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

    CREATE TABLE IF NOT EXISTS playtime_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL DEFAULT 'default',
      playtime_minutes INTEGER NOT NULL,
      recent_minutes INTEGER DEFAULT 0,
      last_played TEXT,
      snapshot_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS pts_game_snapshot_idx ON playtime_snapshots (game_id, snapshot_date);
    -- Required, not just an optimization: insertPlaytimeSnapshot() uses
    -- ON CONFLICT(game_id, user_id, snapshot_date) DO NOTHING, which SQLite
    -- rejects without a matching unique index. Zero-config dev boots (next dev,
    -- no migrations) rely on this line so the first library sync doesn't throw.
    CREATE UNIQUE INDEX IF NOT EXISTS pts_game_user_snapshot_idx
      ON playtime_snapshots (game_id, user_id, snapshot_date);

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
    CREATE INDEX IF NOT EXISTS alert_active_idx ON price_alerts (user_id, is_active);

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

    CREATE TABLE IF NOT EXISTS recommendation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default',
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      bucket TEXT NOT NULL,
      reason TEXT NOT NULL,
      score REAL,
      shown_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT,
      dismissed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS re_user_game_idx ON recommendation_events (user_id, game_id);
    CREATE INDEX IF NOT EXISTS re_user_shown_idx ON recommendation_events (user_id, shown_at);
  `);

  // Better Auth tables — created from the shared AUTH_TABLES_DDL source of truth
  // so this create path and the legacy-migration recreate path can never drift.
  sqlite.exec(AUTH_TABLES_DDL);

  // Schema migrations for existing databases
  try {
    sqlite.exec(`ALTER TABLE price_snapshots ADD COLUMN deal_score INTEGER`);
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    sqlite.exec(`ALTER TABLE games ADD COLUMN hltb_manual INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migrate auth tables from a legacy camelCase schema to snake_case WITHOUT
  // ever silently dropping populated auth tables. This is a data-loss guard:
  // populated legacy tables fail loud; only empty (or explicitly-gated + backed
  // up) tables are recreated. See reconcileLegacyAuthSchema for the full rules.
  reconcileLegacyAuthSchema(sqlite);
}

function createDb() {
  const config = getConfig();
  const sqlite = new Database(config.databaseUrl);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -32768'); // 32 MB page cache (negative = kibibytes)
  sqlite.pragma('mmap_size = 134217728'); // 128 MB memory-mapped I/O
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
