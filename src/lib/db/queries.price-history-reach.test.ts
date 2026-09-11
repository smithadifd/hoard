import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { createTestDb, seedGame, seedUserGame, seedPriceSnapshot, seedPriceAlert } from './test-helpers';
import type { TestDb } from './test-helpers';

// Same adapter the rest of the query tests use: the real query module over an
// in-memory SQLite, with getDb() swapped for the test database.
let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

import {
  getPriceHistoryRetryCandidates,
  getActivePriceAlerts,
  getAutoAlertCandidates,
  incrementPriceHistoryMissCount,
  PRICE_HISTORY_GIVE_UP_MISSES,
} from './queries';

// Repro case: "The Darkside Detective: A Fumble in the Dark" (Steam 795420),
// released Apr 15, 2021; Hoard's snapshots for it begin 2026-02-06.
const REPRO = {
  steamAppId: 795420,
  title: 'The Darkside Detective: A Fumble in the Dark',
  releaseDate: 'Apr 15, 2021',
  earliestSnapshot: '2026-02-06',
};

beforeEach(() => {
  testDb = createTestDb();
});

function seedRepro(overrides: { backfilledAt?: Date | null; itadGameId?: string | null; missCount?: number } = {}) {
  const gameId = seedGame(testDb, {
    steamAppId: REPRO.steamAppId,
    title: REPRO.title,
    releaseDate: REPRO.releaseDate,
    isReleased: true,
    itadGameId: overrides.itadGameId === undefined ? 'itad-darkside-2' : overrides.itadGameId,
    priceHistoryBackfilledAt: overrides.backfilledAt === undefined ? new Date('2026-06-01T05:00:00Z') : overrides.backfilledAt,
    priceHistoryMissCount: overrides.missCount ?? 0,
  });
  seedUserGame(testDb, gameId, { isWishlisted: true, isWatchlisted: true });
  seedPriceSnapshot(testDb, gameId, { snapshotDate: '2026-03-01', priceCurrent: 5.99 });
  seedPriceSnapshot(testDb, gameId, { snapshotDate: REPRO.earliestSnapshot, priceCurrent: 12.99 });
  seedPriceSnapshot(testDb, gameId, { snapshotDate: '2026-09-10', priceCurrent: 3.99, isHistoricalLow: true, historicalLowPrice: 3.99, dealScore: 80 });
  return gameId;
}

describe('getPriceHistoryRetryCandidates (S4)', () => {
  const stampedBefore = new Date('2026-08-12T00:00:00Z'); // now (2026-09-11) minus the 30-day cooldown

  it('returns the repro game — stamped 2026-06-01, ITAD-linked — with its launch and earliest snapshot', () => {
    const gameId = seedRepro();
    const rows = getPriceHistoryRetryCandidates(stampedBefore);
    expect(rows).toEqual([
      {
        id: gameId,
        title: REPRO.title,
        itadGameId: 'itad-darkside-2',
        releaseDate: REPRO.releaseDate,
        earliestSnapshotDate: REPRO.earliestSnapshot,
        priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z'),
        priceHistoryMissCount: 0,
      },
    ]);
  });

  it('excludes a stamp younger than the cutoff, an unlinked game, and never-backfilled games', () => {
    seedRepro({ backfilledAt: new Date('2026-09-01T05:00:00Z') });
    const unlinked = seedGame(testDb, { steamAppId: 2, title: 'Unlinked', releaseDate: 'Jan 1, 2019', itadGameId: null, priceHistoryBackfilledAt: new Date('2026-06-01T05:00:00Z') });
    seedUserGame(testDb, unlinked, { isOwned: true });
    const fresh = seedGame(testDb, { steamAppId: 3, title: 'Never Backfilled', releaseDate: 'Jan 1, 2019', itadGameId: 'itad-3', priceHistoryBackfilledAt: null });
    seedUserGame(testDb, fresh, { isOwned: true });

    expect(getPriceHistoryRetryCandidates(stampedBefore)).toEqual([]);
  });

  it('scopes to the user when given one', () => {
    seedRepro();
    expect(getPriceHistoryRetryCandidates(stampedBefore, 'someone-else')).toEqual([]);
    expect(getPriceHistoryRetryCandidates(stampedBefore, 'default')).toHaveLength(1);
  });
});

describe('alert rows carry launch + earliest snapshot (S9)', () => {
  it('getActivePriceAlerts exposes releaseDate and earliestSnapshotDate', () => {
    const gameId = seedRepro();
    seedPriceAlert(testDb, gameId, { notifyOnAllTimeLow: true });
    const [row] = getActivePriceAlerts('default');
    expect(row.gameId).toBe(gameId);
    expect(row.releaseDate).toBe(REPRO.releaseDate);
    expect(row.earliestSnapshotDate).toBe(REPRO.earliestSnapshot);
  });

  it('getAutoAlertCandidates exposes releaseDate and earliestSnapshotDate', () => {
    const gameId = seedRepro();
    const [row] = getAutoAlertCandidates('default', 55);
    expect(row.gameId).toBe(gameId);
    expect(row.releaseDate).toBe(REPRO.releaseDate);
    expect(row.earliestSnapshotDate).toBe(REPRO.earliestSnapshot);
  });
});

describe('incrementPriceHistoryMissCount restarts the cooldown on any retry-path miss (S10)', () => {
  it('a miss on an already-given-up game moves the stamp forward so the cooldown restarts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    try {
      const gameId = seedRepro({ backfilledAt: new Date('2026-06-01T05:00:00Z'), missCount: PRICE_HISTORY_GIVE_UP_MISSES });
      incrementPriceHistoryMissCount(gameId);
      const row = testDb.select({
        stamp: schema.games.priceHistoryBackfilledAt,
        misses: schema.games.priceHistoryMissCount,
      }).from(schema.games).where(eq(schema.games.id, gameId)).get()!;
      expect(row.misses).toBe(PRICE_HISTORY_GIVE_UP_MISSES + 1);
      expect(row.stamp).toEqual(new Date('2026-09-11T12:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a first miss on a stamped game (retry path, count 0 → 1) also refreshes the stamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    try {
      const gameId = seedRepro({ backfilledAt: new Date('2026-06-01T05:00:00Z'), missCount: 0 });
      incrementPriceHistoryMissCount(gameId);
      const row = testDb.select({ stamp: schema.games.priceHistoryBackfilledAt, misses: schema.games.priceHistoryMissCount })
        .from(schema.games).where(eq(schema.games.id, gameId)).get()!;
      expect(row.misses).toBe(1);
      expect(row.stamp).toEqual(new Date('2026-09-11T12:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a miss under the threshold on a never-stamped game leaves the stamp NULL (first-pass semantics unchanged)', () => {
    const gameId = seedRepro({ backfilledAt: null, missCount: 0 });
    incrementPriceHistoryMissCount(gameId);
    const row = testDb.select({ stamp: schema.games.priceHistoryBackfilledAt, misses: schema.games.priceHistoryMissCount })
      .from(schema.games).where(eq(schema.games.id, gameId)).get()!;
    expect(row.misses).toBe(1);
    expect(row.stamp).toBeNull();
  });
});
