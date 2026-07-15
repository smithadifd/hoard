/**
 * Regression tests for the destructive auth-table-drop guard.
 *
 * Historically, `ensureSchema` unconditionally dropped the user/session/account/
 * verification tables whenever it detected a legacy camelCase `emailVerified`
 * column — an implicit, un-backed-up data-loss path that ran at request-time DB
 * init. These tests pin the safe behavior: populated legacy tables FAIL LOUD
 * (throw) instead of being dropped; only empty (or explicitly-gated + backed-up)
 * legacy tables are recreated.
 *
 * The headline test (`REGRESSION: ...`) fails against main's behavior — main
 * silently drops the rows, so both the "throws" and the "data survives"
 * assertions fail — and passes on this branch.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { ensureSchema, reconcileLegacyAuthSchema } from './index';

const RESET_ENV = 'HOARD_ALLOW_AUTH_TABLE_RESET';

/** Better Auth's legacy camelCase auth schema (the shape that triggered the drop). */
const LEGACY_AUTH_DDL = `
  CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );
`;

function newSqlite(): BetterSqlite3.Database {
  const sqlite = new Database(':memory:');
  // Mirror production pragmas from createDb().
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = true');
  return sqlite;
}

/** Create a raw DB with the legacy camelCase auth schema, optionally with real rows. */
function createLegacyDb(opts: { seed: boolean }): BetterSqlite3.Database {
  const sqlite = newSqlite();
  sqlite.exec(LEGACY_AUTH_DDL);
  if (opts.seed) {
    sqlite
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('u1', 'Andrew', 'andrew@example.com', 1, 1000, 1000);
    sqlite
      .prepare(
        `INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('a1', 'u1', 'u1', 'credential', 'hashed-password-secret', 1000, 1000);
    sqlite
      .prepare(
        `INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('s1', 'u1', 'session-token-123', 9_999_999_999, 1000, 1000);
    sqlite
      .prepare(`INSERT INTO verification (id, identifier, value, expiresAt) VALUES (?, ?, ?, ?)`)
      .run('v1', 'andrew@example.com', 'verify-code', 9_999_999_999);
  }
  return sqlite;
}

function count(sqlite: BetterSqlite3.Database, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
}

function columns(sqlite: BetterSqlite3.Database, table: string): string[] {
  const rows = sqlite
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe('reconcileLegacyAuthSchema — destructive auth-table-drop guard', () => {
  afterEach(() => {
    delete process.env[RESET_ENV];
    vi.restoreAllMocks();
  });

  it('REGRESSION: refuses to drop populated legacy camelCase auth tables and preserves the data', () => {
    const sqlite = createLegacyDb({ seed: true });

    // The fixed request-time init path must FAIL LOUD rather than drop data.
    // (On main this does NOT throw — it silently drops — so this line fails there.)
    expect(() => ensureSchema(sqlite)).toThrow(/Refusing to auto-drop/i);

    // The whole point: real user/session/account/verification data survives.
    // (On main these are all 0 because the tables were dropped and recreated.)
    expect(count(sqlite, 'user')).toBe(1);
    expect(count(sqlite, 'session')).toBe(1);
    expect(count(sqlite, 'account')).toBe(1);
    expect(count(sqlite, 'verification')).toBe(1);

    // Credentials specifically are intact — not dropped/recreated.
    const account = sqlite
      .prepare(`SELECT password FROM account WHERE id = 'a1'`)
      .get() as { password: string };
    expect(account.password).toBe('hashed-password-secret');

    // The tables were left completely untouched (still the legacy shape).
    expect(columns(sqlite, 'user')).toContain('emailVerified');

    sqlite.close();
  });

  it('fails loud with an actionable message (names the override flag + migration path)', () => {
    const sqlite = createLegacyDb({ seed: true });

    let message = '';
    try {
      reconcileLegacyAuthSchema(sqlite);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain(RESET_ENV);
    expect(message).toMatch(/migrate/i);
    expect(message).toMatch(/snake_case/i);
    expect(message).toMatch(/4 existing row/); // 1 user + 1 session + 1 account + 1 verification

    sqlite.close();
  });

  it('safely migrates an EMPTY legacy camelCase schema to snake_case (nothing to lose)', () => {
    const sqlite = createLegacyDb({ seed: false });

    expect(() => ensureSchema(sqlite)).not.toThrow();

    // Converted to the snake_case shape Better Auth expects.
    expect(columns(sqlite, 'user')).toContain('email_verified');
    expect(columns(sqlite, 'user')).not.toContain('emailVerified');

    sqlite.close();
  });

  it('bootstraps a fresh empty database without dropping anything (fresh-DB path unaffected)', () => {
    const sqlite = newSqlite();

    expect(() => ensureSchema(sqlite)).not.toThrow();

    // Auth tables created in snake_case; the detection branch was a no-op.
    expect(columns(sqlite, 'user')).toContain('email_verified');
    expect(columns(sqlite, 'user')).not.toContain('emailVerified');

    // App tables exist too — a real, usable fresh DB.
    const games = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='games'`)
      .get();
    expect(games).toBeDefined();

    sqlite.close();
  });

  it('never drops an existing populated snake_case DB (the everyday re-init/upgrade path)', () => {
    const sqlite = newSqlite();

    // First boot creates the current snake_case schema.
    ensureSchema(sqlite);

    // A real user exists.
    sqlite
      .prepare(
        `INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'Andrew', 'a@example.com', 1)`
      )
      .run();

    // The next boot re-runs ensureSchema — it must not throw or drop.
    expect(() => ensureSchema(sqlite)).not.toThrow();
    expect(count(sqlite, 'user')).toBe(1);

    sqlite.close();
  });

  it('gated override on an in-memory DB REFUSES the reset (fail closed — no backup possible)', () => {
    // Defense in depth: the "backup before reset" invariant must hold
    // UNCONDITIONALLY. An in-memory DB cannot be backed up, so even with the
    // override flag set, a populated reset must be refused rather than dropping
    // the data unprotected.
    process.env[RESET_ENV] = 'true';
    const sqlite = createLegacyDb({ seed: true });

    expect(() => ensureSchema(sqlite)).toThrow(/could not be taken/i);

    // Populated data is untouched — never dropped without a backup.
    expect(count(sqlite, 'user')).toBe(1);
    expect(count(sqlite, 'session')).toBe(1);
    expect(count(sqlite, 'account')).toBe(1);
    expect(count(sqlite, 'verification')).toBe(1);
    expect(columns(sqlite, 'user')).toContain('emailVerified');

    sqlite.close();
  });

  it('gated override on a FILE DB backs up first, then resets (happy path — backup preserves the data)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[RESET_ENV] = 'true';
    const dir = mkdtempSync(join(tmpdir(), 'hoard-r18-'));
    const dbPath = join(dir, 'hoard.db');

    try {
      // Build a populated legacy camelCase DB on disk.
      const seed = new Database(dbPath);
      seed.exec(LEGACY_AUTH_DDL);
      seed
        .prepare(
          `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('u1', 'Andrew', 'andrew@example.com', 1, 1000, 1000);
      seed.close();

      const sqlite = new Database(dbPath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = true');

      expect(() => ensureSchema(sqlite)).not.toThrow();

      // Live DB was reset to snake_case; legacy data discarded under the flag.
      expect(columns(sqlite, 'user')).toContain('email_verified');
      expect(columns(sqlite, 'user')).not.toContain('emailVerified');
      expect(count(sqlite, 'user')).toBe(0);
      sqlite.close();

      // The invariant: a backup was written BEFORE the reset and it preserved
      // the original row — the data was never dropped without a copy on disk.
      const backups = readdirSync(dir).filter((f) => f.includes('.auth-reset-backup-'));
      expect(backups.length).toBe(1);
      const backup = new Database(join(dir, backups[0]));
      const backupUsers = backup.prepare(`SELECT COUNT(*) AS c FROM user`).get() as { c: number };
      expect(backupUsers.c).toBe(1);
      backup.close();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('backup written to'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
