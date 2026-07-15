import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame, seedPlaytimeSnapshot } from './test-helpers';
import type { TestDb } from './test-helpers';
import { userGames } from './schema';

// Mock getDb to return our test database (mirrors queries.test.ts).
let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

// Import query functions AFTER the mock is set up.
import {
  insertPlaytimeSnapshot,
  getPlaytimeHistory,
  getPlaytimeWindow,
  getGamePlaytimeInsight,
  getLibraryPlaytimeRecap,
  pruneOldPlaytimeSnapshots,
  classifyPlaytimeMomentum,
  upsertUserGame,
} from './queries';

/** YYYY-MM-DD for `n` days ago (UTC), matching production daysAgoDate(). */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('playtime_snapshots migration', () => {
  it('migration 0016 creates the table additively on a bare in-memory SQLite', () => {
    const db = new Database(':memory:');
    // Only prerequisite is the referenced games table (FK target).
    db.exec(`CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, steam_app_id INTEGER);`);

    const sqlPath = path.join(process.cwd(), 'drizzle', '0016_brave_living_lightning.sql');
    const migration = readFileSync(sqlPath, 'utf8').replace(/-->\s*statement-breakpoint/g, '');
    db.exec(migration);

    const cols = (db.prepare(`PRAGMA table_info(playtime_snapshots)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      'id',
      'game_id',
      'user_id',
      'playtime_minutes',
      'recent_minutes',
      'last_played',
      'snapshot_date',
      'created_at',
    ]);

    const indexes = (db.prepare(`PRAGMA index_list(playtime_snapshots)`).all() as { name: string }[]).map(
      (i) => i.name,
    );
    expect(indexes).toContain('pts_game_user_snapshot_idx');
    expect(indexes).toContain('pts_game_snapshot_idx');

    // The migration is additive — it must not touch or recreate existing tables.
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration.match(/CREATE TABLE/gi) ?? []).toHaveLength(1);
    db.close();
  });
});

describe('insertPlaytimeSnapshot', () => {
  it('writes a snapshot row', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    insertPlaytimeSnapshot({
      gameId,
      userId: 'default',
      playtimeMinutes: 120,
      recentMinutes: 30,
      lastPlayed: '2026-07-01T00:00:00.000Z',
      snapshotDate: isoDaysAgo(0),
    });

    const history = getPlaytimeHistory(gameId, 'default');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ playtimeMinutes: 120, recentMinutes: 30 });
  });

  it('dedups per (game, user, day) — a same-day re-sync is a no-op (first-write-wins)', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    const today = isoDaysAgo(0);
    insertPlaytimeSnapshot({ gameId, userId: 'default', playtimeMinutes: 100, snapshotDate: today });
    insertPlaytimeSnapshot({ gameId, userId: 'default', playtimeMinutes: 999, snapshotDate: today });

    const history = getPlaytimeHistory(gameId, 'default');
    expect(history).toHaveLength(1);
    expect(history[0].playtimeMinutes).toBe(100);
  });

  it('keeps separate series per user for the same game', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    const today = isoDaysAgo(0);
    insertPlaytimeSnapshot({ gameId, userId: 'default', playtimeMinutes: 100, snapshotDate: today });
    insertPlaytimeSnapshot({ gameId, userId: 'other', playtimeMinutes: 55, snapshotDate: today });

    expect(getPlaytimeHistory(gameId, 'default')[0].playtimeMinutes).toBe(100);
    expect(getPlaytimeHistory(gameId, 'other')[0].playtimeMinutes).toBe(55);
  });
});

describe('the fix: history survives the library-sync overwrite', () => {
  it('preserves each sync’s total even though user_games.playtimeMinutes is overwritten', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedUserGame(testDb, gameId, { isOwned: true, playtimeMinutes: 0 });

    // Sync 1 (yesterday): snapshot BEFORE overwrite, then overwrite to 100.
    insertPlaytimeSnapshot({ gameId, userId: 'default', playtimeMinutes: 100, snapshotDate: isoDaysAgo(1) });
    upsertUserGame(gameId, { isOwned: true, playtimeMinutes: 100 }, 'default');

    // Sync 2 (today): snapshot BEFORE overwrite, then overwrite to 150.
    insertPlaytimeSnapshot({ gameId, userId: 'default', playtimeMinutes: 150, snapshotDate: isoDaysAgo(0) });
    upsertUserGame(gameId, { isOwned: true, playtimeMinutes: 150 }, 'default');

    // user_games keeps only the latest mutable total (what the old code left behind).
    const ug = testDb.select({ playtimeMinutes: userGames.playtimeMinutes })
      .from(userGames)
      .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, 'default')))
      .get();
    expect(ug?.playtimeMinutes).toBe(150);

    // But yesterday's total (100) SURVIVES in the snapshot series — the history
    // the pre-snapshot code destroyed on every sync.
    const history = getPlaytimeHistory(gameId, 'default');
    expect(history.map((h) => h.playtimeMinutes)).toEqual([100, 150]);
    const yesterday = history.find((h) => h.snapshotDate === isoDaysAgo(1));
    expect(yesterday?.playtimeMinutes).toBe(100);
  });
});

describe('getPlaytimeWindow', () => {
  it('measures gain from the most recent snapshot on/before the window start', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 100, snapshotDate: isoDaysAgo(10) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 130, snapshotDate: isoDaysAgo(0) });

    expect(getPlaytimeWindow(gameId, 'default', isoDaysAgo(7))).toEqual({
      baselineMinutes: 100,
      latestMinutes: 130,
      gainedMinutes: 30,
    });
  });

  it('falls back to the earliest sample when nothing precedes the window', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 40, snapshotDate: isoDaysAgo(3) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 90, snapshotDate: isoDaysAgo(0) });

    // No snapshot at/before 7 days ago → baseline is the earliest we have (40).
    expect(getPlaytimeWindow(gameId, 'default', isoDaysAgo(7))).toEqual({
      baselineMinutes: 40,
      latestMinutes: 90,
      gainedMinutes: 50,
    });
  });

  it('clamps a decrease (refund / playtime reset) to zero gain', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 100, snapshotDate: isoDaysAgo(10) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 40, snapshotDate: isoDaysAgo(0) });

    expect(getPlaytimeWindow(gameId, 'default', isoDaysAgo(7))?.gainedMinutes).toBe(0);
  });

  it('reports zero gain for a single snapshot and null when there are none', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    expect(getPlaytimeWindow(gameId, 'default', isoDaysAgo(7))).toBeNull();

    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 77, snapshotDate: isoDaysAgo(0) });
    expect(getPlaytimeWindow(gameId, 'default', isoDaysAgo(7))?.gainedMinutes).toBe(0);
  });
});

describe('classifyPlaytimeMomentum', () => {
  it('classifies the four buckets', () => {
    expect(
      classifyPlaytimeMomentum({ gainedThisWeek: 60, gainedThisMonth: 60, totalMinutes: 500, recentMinutes: 0 }),
    ).toBe('playing');
    // Steam 2-week activity counts as playing even without a measured weekly delta.
    expect(
      classifyPlaytimeMomentum({ gainedThisWeek: 0, gainedThisMonth: 0, totalMinutes: 500, recentMinutes: 45 }),
    ).toBe('playing');
    expect(
      classifyPlaytimeMomentum({ gainedThisWeek: 0, gainedThisMonth: 120, totalMinutes: 500, recentMinutes: 0 }),
    ).toBe('cooling');
    expect(
      classifyPlaytimeMomentum({ gainedThisWeek: 0, gainedThisMonth: 0, totalMinutes: 500, recentMinutes: 0 }),
    ).toBe('dormant');
    expect(
      classifyPlaytimeMomentum({ gainedThisWeek: 0, gainedThisMonth: 0, totalMinutes: 5, recentMinutes: 0 }),
    ).toBe('untouched');
  });
});

describe('getGamePlaytimeInsight', () => {
  it('returns null when the game has no snapshots yet', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedUserGame(testDb, gameId, { isOwned: true });
    expect(getGamePlaytimeInsight(gameId, 'default')).toBeNull();
  });

  it('derives hours-this-week/month, momentum, and value-accrual $/hr', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedUserGame(testDb, gameId, { isOwned: true, pricePaid: 20 });

    // Roughly-daily cadence so the week/month baselines land on real samples.
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 200, snapshotDate: isoDaysAgo(35) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 220, snapshotDate: isoDaysAgo(30) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 460, snapshotDate: isoDaysAgo(7) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 520, recentMinutes: 60, snapshotDate: isoDaysAgo(0) });

    const insight = getGamePlaytimeInsight(gameId, 'default');
    expect(insight).not.toBeNull();
    expect(insight!.totalMinutes).toBe(520);
    expect(insight!.hoursThisWeek).toBe(1); // 520 - 460 = 60 min
    expect(insight!.hoursThisMonth).toBe(5); // 520 - 220 = 300 min
    expect(insight!.momentum).toBe('playing');

    // $20 over 8.67h now = $2.31/hr; a month ago over 3.67h = $5.45/hr → improved.
    expect(insight!.valueAccrual).toEqual({
      pricePaid: 20,
      dollarsPerHourNow: 2.31,
      dollarsPerHourMonthAgo: 5.45,
      improved: true,
    });
  });

  it('omits value-accrual when no price was paid', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedUserGame(testDb, gameId, { isOwned: true });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 600, snapshotDate: isoDaysAgo(40) });

    const insight = getGamePlaytimeInsight(gameId, 'default');
    expect(insight!.momentum).toBe('dormant'); // played 10h once, quiet for a month
    expect(insight!.valueAccrual).toBeNull();
  });
});

describe('getLibraryPlaytimeRecap', () => {
  it('rolls up hours this week/month and ranks the week’s top gainers', () => {
    const a = seedGame(testDb, { steamAppId: 1, title: 'Active Game' });
    const b = seedGame(testDb, { steamAppId: 2, title: 'Idle Game' });
    seedUserGame(testDb, a, { isOwned: true });
    seedUserGame(testDb, b, { isOwned: true });

    // A gained 60 min this week; B is flat.
    seedPlaytimeSnapshot(testDb, a, { playtimeMinutes: 100, snapshotDate: isoDaysAgo(7) });
    seedPlaytimeSnapshot(testDb, a, { playtimeMinutes: 160, snapshotDate: isoDaysAgo(0) });
    seedPlaytimeSnapshot(testDb, b, { playtimeMinutes: 50, snapshotDate: isoDaysAgo(7) });
    seedPlaytimeSnapshot(testDb, b, { playtimeMinutes: 50, snapshotDate: isoDaysAgo(0) });

    const recap = getLibraryPlaytimeRecap('default');
    expect(recap.hoursThisWeek).toBe(1); // 60 min from A
    expect(recap.gamesPlayedThisWeek).toBe(1);
    expect(recap.topGainers).toEqual([{ gameId: a, title: 'Active Game', hoursThisWeek: 1 }]);
  });

  it('returns zeros for a library with no recent snapshots', () => {
    const g = seedGame(testDb, { steamAppId: 1, title: 'Old Game' });
    seedUserGame(testDb, g, { isOwned: true });
    seedPlaytimeSnapshot(testDb, g, { playtimeMinutes: 300, snapshotDate: isoDaysAgo(200) });

    const recap = getLibraryPlaytimeRecap('default');
    expect(recap).toEqual({ hoursThisWeek: 0, hoursThisMonth: 0, gamesPlayedThisWeek: 0, topGainers: [] });
  });
});

describe('pruneOldPlaytimeSnapshots', () => {
  it('deletes snapshots older than the retention window, keeps recent ones', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 10, snapshotDate: isoDaysAgo(200) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 20, snapshotDate: isoDaysAgo(30) });

    const deleted = pruneOldPlaytimeSnapshots(180);
    expect(deleted).toBe(1);

    const history = getPlaytimeHistory(gameId, 'default');
    expect(history).toHaveLength(1);
    expect(history[0].playtimeMinutes).toBe(20);
  });
});
