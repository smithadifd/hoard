import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// End-to-end sign-up → sign-in through the real Better Auth instance against a
// real ensureSchema()-bootstrapped SQLite file. Guards against an auth-library
// bump changing its required schema (better-auth 1.7.3+ no longer writes
// account.issuer; a leftover NOT NULL column rejects every sign-up).
const TMP_DB = path.join(os.tmpdir(), `hoard-auth-signin-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_URL = TMP_DB;
process.env.BETTER_AUTH_SECRET ??= 'test-secret-at-least-32-characters-long';

// NOTE: deliberately NOT mocking '@/lib/db' — we want the real bootstrap.
import { getDb, reconcileAccountIssuer } from '@/lib/db';
import { auth } from './auth';

const EMAIL = 'owner@example.com';
const PASSWORD = 'correct-horse-battery';

afterAll(() => {
  try {
    getDb().$client.close();
  } catch {
    // already closed
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${TMP_DB}${suffix}`;
    if (existsSync(f)) {
      try {
        unlinkSync(f);
      } catch {
        // best-effort cleanup
      }
    }
  }
});

describe('email/password sign-in (real Better Auth + ensureSchema)', () => {
  it('signs in the account created by sign-up on a fresh install', async () => {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Owner' } });

    const res = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
    expect(res.user.email).toBe(EMAIL);
  });

  it('rejects a wrong password', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: EMAIL, password: 'not-the-password' } }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('upgrades a pre-1.7 account table (no issuer column) so the existing login still works', async () => {
    const client = getDb().$client;

    // Reshape the account table to how a pre-1.7 install (prod) has it.
    client.exec(`DROP INDEX account_issuer_account_id_idx`);
    client.exec(`ALTER TABLE account DROP COLUMN issuer`);

    reconcileAccountIssuer(client);

    const row = client.prepare(`SELECT issuer FROM account WHERE provider_id = 'credential'`).get() as {
      issuer: string;
    };
    expect(row.issuer).toBe('local:credential');
    const idx = client
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='account_issuer_account_id_idx'`)
      .all();
    expect(idx).toHaveLength(1);

    const res = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
    expect(res.user.email).toBe(EMAIL);
  });

  it('is idempotent on an already-upgraded table', () => {
    const client = getDb().$client;
    expect(() => reconcileAccountIssuer(client)).not.toThrow();
    expect(() => reconcileAccountIssuer(client)).not.toThrow();
  });

  it('accepts an account insert without an issuer and keeps existing issuer values through the migration', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        image TEXT,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE account (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        issuer TEXT NOT NULL,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        id_token TEXT,
        password TEXT,
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX account_issuer_account_id_idx ON account (issuer, account_id);
    `);
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)`,
    ).run('user-kept', 'Kept', 'kept@example.com');
    db.prepare(
      `INSERT INTO account (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'credential', 'x', 0, 0)`,
    ).run('acc-kept', 'user-kept', 'kept-issuer-value', 'user-kept');

    const migration = readFileSync(path.join(process.cwd(), 'drizzle', '0019_fast_gauntlet.sql'), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) db.exec(trimmed);
    }

    const kept = db.prepare(`SELECT issuer FROM account WHERE id = 'acc-kept'`).get() as { issuer: string | null };
    expect(kept.issuer).toBe('kept-issuer-value');

    expect(() => {
      db.prepare(
        `INSERT INTO account (id, user_id, account_id, provider_id, created_at, updated_at)
         VALUES ('acc-new', 'user-kept', 'other-account', 'credential', 0, 0)`,
      ).run();
    }).not.toThrow();
    const inserted = db.prepare(`SELECT issuer FROM account WHERE id = 'acc-new'`).get() as { issuer: string | null };
    expect(inserted.issuer).toBeNull();
    db.close();

    // Better Auth 1.7.3+ never writes issuer. Restoring `.notNull()` on the
    // Drizzle field makes this call fail with SCHEMA_MISMATCH.
    const live = getDb().$client;
    const existing = live.prepare(`SELECT id FROM user WHERE email = ?`).get(EMAIL);
    if (!existing) {
      await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Owner' } });
    }
    const res = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
    expect(res.user.email).toBe(EMAIL);
  });
});
