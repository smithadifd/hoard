import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the real getDb()/getConfig() at a throwaway file BEFORE importing them,
// so this test exercises the actual ensureSchema() bootstrap — the zero-config
// path a plain `next dev` boot takes (no migrations run). getConfig() and
// getDb() are both lazy, so setting the env before the first call is enough.
const TMP_DB = path.join(os.tmpdir(), `hoard-ensure-schema-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_URL = TMP_DB;

// NOTE: deliberately NOT mocking './index' — we want the real bootstrap.
import { getDb } from './index';
import { insertPlaytimeSnapshot, getPlaytimeHistory } from './queries';

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

describe('ensureSchema bootstrap (dev path, no migrations)', () => {
  it('creates playtime_snapshots and its unique index so the sync write-path works', () => {
    const client = getDb().$client;

    // Table exists straight from the bootstrap.
    const tables = client
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='playtime_snapshots'`)
      .all();
    expect(tables).toHaveLength(1);

    // The unique index exists — without it the ON CONFLICT write-path throws.
    const indexes = client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='pts_game_user_snapshot_idx'`,
      )
      .all();
    expect(indexes).toHaveLength(1);

    // Drive the real insert (the exact call library-sync makes): a same-day
    // re-insert must dedup rather than throw — proving the unique index is live.
    client.prepare(`INSERT INTO games (steam_app_id, title) VALUES (?, ?)`).run(1, 'Game');
    expect(() => {
      insertPlaytimeSnapshot({ gameId: 1, userId: 'default', playtimeMinutes: 100, snapshotDate: '2026-07-15' });
      insertPlaytimeSnapshot({ gameId: 1, userId: 'default', playtimeMinutes: 999, snapshotDate: '2026-07-15' });
    }).not.toThrow();

    const history = getPlaytimeHistory(1, 'default');
    expect(history).toHaveLength(1); // deduped by the bootstrap's unique index
    expect(history[0].playtimeMinutes).toBe(100);
  });
});
