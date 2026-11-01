import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, seedGame, seedPriceSnapshot, seedPlaytimeSnapshot } from './test-helpers';
import type { TestDb } from './test-helpers';
import { priceSnapshots, playtimeSnapshots } from './schema';

let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

import { runSnapshotPrune } from './queries';

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('runSnapshotPrune (the monthly snapshot-prune task)', () => {
  // Price history is the evidence behind every all-time-low claim. Backfilled ITAD
  // history reaches years back; deleting it made every backfilled game read as
  // "history too short to trust" after each monthly prune.
  it('keeps price snapshots of any age', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: '2018-02-28' });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: isoDaysAgo(200) });
    seedPriceSnapshot(testDb, gameId, { snapshotDate: isoDaysAgo(10) });

    runSnapshotPrune();

    const dates = testDb
      .select({ d: priceSnapshots.snapshotDate })
      .from(priceSnapshots)
      .all()
      .map((r) => r.d)
      .sort();
    expect(dates).toEqual(['2018-02-28', isoDaysAgo(200), isoDaysAgo(10)].sort());
  });

  it('still prunes playtime snapshots past the retention window', () => {
    const gameId = seedGame(testDb, { steamAppId: 1, title: 'Game' });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 10, snapshotDate: isoDaysAgo(200) });
    seedPlaytimeSnapshot(testDb, gameId, { playtimeMinutes: 20, snapshotDate: isoDaysAgo(30) });

    const result = runSnapshotPrune();

    expect(result).toEqual({ deletedPlaytime: 1 });
    expect(testDb.select().from(playtimeSnapshots).all()).toHaveLength(1);
  });
});
