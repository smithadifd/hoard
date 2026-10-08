import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// End-to-end sign-up → sign-in through the real Better Auth instance against a
// real ensureSchema()-bootstrapped SQLite file. Guards against an auth-library
// bump changing its required schema (better-auth 1.7.3+ no longer writes
// account.issuer; a leftover NOT NULL column rejects every sign-up).
const TMP_DB = path.join(os.tmpdir(), `hoard-auth-signin-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_URL = TMP_DB;
process.env.BETTER_AUTH_SECRET ??= 'test-secret-at-least-32-characters-long';

// NOTE: deliberately NOT mocking '@/lib/db' — we want the real bootstrap.
import { getDb } from '@/lib/db';
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

});
