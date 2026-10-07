import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// End-to-end sign-up → sign-in through the real Better Auth instance against a
// real ensureSchema()-bootstrapped SQLite file. Guards against an auth-library
// bump changing its required schema (better-auth 1.7 added account.issuer and
// every sign-in failed with "User not found" while CI stayed green).
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
});
