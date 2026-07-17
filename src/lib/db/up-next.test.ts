import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedGame, seedUserGame, seedPlaytimeSnapshot } from './test-helpers';
import type { TestDb } from './test-helpers';

let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return { getDb: () => testDb, schema: actualSchema };
});

import { getUpNextQueue } from './queries';

/** YYYY-MM-DD for `n` days ago (UTC) — matches production daysAgoDate(). */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function isoDateTimeDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('getUpNextQueue', () => {
  it('buckets a near-complete game as finish-soon', () => {
    const g = seedGame(testDb, { steamAppId: 1, title: 'AlmostDone', hltbMain: 20, reviewScore: 85 });
    seedUserGame(testDb, g, { isOwned: true, completionStatus: 'playing', playtimeMinutes: 15 * 60 });

    const q = getUpNextQueue('default');
    const entry = q.find((e) => e.gameId === g);
    expect(entry?.bucket).toBe('finish-soon');
    expect(entry?.reason).toContain('finish');
  });

  it('buckets an unplayed well-reviewed game as start-fresh', () => {
    const g = seedGame(testDb, { steamAppId: 2, title: 'Fresh', hltbMain: 12, reviewScore: 92 });
    seedUserGame(testDb, g, { isOwned: true, playtimeMinutes: 0 });

    const q = getUpNextQueue('default');
    expect(q.find((e) => e.gameId === g)?.bucket).toBe('start-fresh');
  });

  it('excludes beaten/abandoned games from the queue', () => {
    const beaten = seedGame(testDb, { steamAppId: 3, title: 'Beaten', hltbMain: 10, reviewScore: 90 });
    seedUserGame(testDb, beaten, { isOwned: true, completionStatus: 'beaten', playtimeMinutes: 700 });
    const abandoned = seedGame(testDb, { steamAppId: 4, title: 'Abandoned', hltbMain: 10, reviewScore: 90 });
    seedUserGame(testDb, abandoned, { isOwned: true, completionStatus: 'abandoned', playtimeMinutes: 300 });

    const q = getUpNextQueue('default');
    expect(q.find((e) => e.gameId === beaten)).toBeUndefined();
    expect(q.find((e) => e.gameId === abandoned)).toBeUndefined();
  });

  it('derives momentum from playtime_snapshots: a recent gain surfaces the game as continue', () => {
    // recentMinutes stays 0 (Steam 2-week counter), so ONLY the snapshot delta
    // can mark this game active — proving the snapshot series drives momentum.
    const g = seedGame(testDb, { steamAppId: 5, title: 'Momentum', hltbMain: 40, reviewScore: 80 });
    seedUserGame(testDb, g, { isOwned: true, completionStatus: 'playing', playtimeMinutes: 200, lastPlayed: isoDateTimeDaysAgo(2) });
    // 10 days ago the total was 100; today it's 200 → +100 min gained this week.
    seedPlaytimeSnapshot(testDb, g, { playtimeMinutes: 100, snapshotDate: isoDaysAgo(10) });
    seedPlaytimeSnapshot(testDb, g, { playtimeMinutes: 200, snapshotDate: isoDaysAgo(0) });

    const q = getUpNextQueue('default');
    const entry = q.find((e) => e.gameId === g);
    expect(entry?.bucket).toBe('continue');
    expect(entry?.reason).toContain('Pick up where you left off');
  });

  it('a dormant, invested, worth-returning game (forgotten favourite) surfaces as continue', () => {
    const g = seedGame(testDb, { steamAppId: 6, title: 'Forgotten', hltbMain: 60, reviewScore: 93 });
    seedUserGame(testDb, g, {
      isOwned: true,
      completionStatus: 'playing',
      playtimeMinutes: 8 * 60,
      personalInterest: 5,
      lastPlayed: isoDateTimeDaysAgo(220),
    });
    // One stale snapshot, same total as now → no recent gain → dormant.
    seedPlaytimeSnapshot(testDb, g, { playtimeMinutes: 8 * 60, snapshotDate: isoDaysAgo(60) });

    const q = getUpNextQueue('default');
    const entry = q.find((e) => e.gameId === g);
    expect(entry?.bucket).toBe('continue');
    expect(entry?.reason).toContain('worth another look');
  });

  it('caps the queue at maxItems', () => {
    for (let i = 0; i < 8; i++) {
      const g = seedGame(testDb, { steamAppId: 100 + i, title: `G${i}`, hltbMain: 10, reviewScore: 80 });
      seedUserGame(testDb, g, { isOwned: true, playtimeMinutes: 0 });
    }
    expect(getUpNextQueue('default', { maxItems: 5 })).toHaveLength(5);
    expect(getUpNextQueue('default', { maxItems: 3 })).toHaveLength(3);
  });
});
