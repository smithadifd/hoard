import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame } from './test-helpers';
import type { TestDb } from './test-helpers';
import * as schema from './schema';

let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

import {
  getGamesForSteamPlaytimeSync,
  getGamesForHltbSync,
  getGamesForMetadataRefresh,
  updateGameSteamPlaytime,
  updateGameHltbData,
  updateGameMetadata,
  updateReleaseStatus,
} from './queries';

const NOW = new Date('2026-11-01T12:00:00Z');

function setGame(gameId: number, values: Partial<typeof schema.games.$inferInsert>) {
  testDb.update(schema.games).set(values).where(eq(schema.games.id, gameId)).run();
}

function readGame(gameId: number) {
  return testDb.select().from(schema.games).where(eq(schema.games.id, gameId)).get()!;
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('getGamesForSteamPlaytimeSync', () => {
  it('picks up a game that gave up before launch (Car Park Capital)', () => {
    // Prod state on 2026-11-01: wishlisted since February, three misses in July
    // before any reviews existed, launched Oct 9 with 1,282 reviews.
    const id = seedGame(testDb, {
      steamAppId: 3031880,
      title: 'Car Park Capital',
      releaseDate: 'Oct 9, 2026',
      isReleased: true,
      reviewCount: 1282,
      steamPlaytimeMissCount: 3,
    });
    setGame(id, { steamPlaytimeUpdatedAt: '2026-07-04T02:31:03.229Z' });
    seedUserGame(testDb, id, { isWishlisted: true });

    expect(getGamesForSteamPlaytimeSync(NOW).map((g) => g.title)).toEqual(['Car Park Capital']);
  });

  it('skips games Steam says are unreleased', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Coming Soon', isReleased: false, releaseDate: 'Dec 14, 2026' });
    seedUserGame(testDb, id, { isWishlisted: true });

    expect(getGamesForSteamPlaytimeSync(NOW)).toEqual([]);
  });

  it('re-samples a young game whose median is a week old, but not an established one', () => {
    const young = seedGame(testDb, {
      steamAppId: 1, title: 'Young', releaseDate: 'Oct 9, 2026', isReleased: true, steamPlaytimeMedian: 3,
    });
    const established = seedGame(testDb, {
      steamAppId: 2, title: 'Established', releaseDate: 'Jun 25, 2024', isReleased: true, steamPlaytimeMedian: 9,
    });
    setGame(young, { steamPlaytimeUpdatedAt: '2026-10-20T00:00:00.000Z' });
    setGame(established, { steamPlaytimeUpdatedAt: '2026-10-20T00:00:00.000Z' });
    seedUserGame(testDb, young, { isWishlisted: true });
    seedUserGame(testDb, established, { isWishlisted: true });

    expect(getGamesForSteamPlaytimeSync(NOW).map((g) => g.title)).toEqual(['Young']);
  });

  it('lists games with no median before median refreshes', () => {
    const refresh = seedGame(testDb, {
      steamAppId: 1, title: 'Refresh', releaseDate: 'Oct 9, 2026', isReleased: true, steamPlaytimeMedian: 3, reviewCount: 5000,
    });
    const missing = seedGame(testDb, { steamAppId: 2, title: 'Missing', isReleased: true, reviewCount: 10 });
    setGame(refresh, { steamPlaytimeUpdatedAt: '2026-10-01T00:00:00.000Z' });
    seedUserGame(testDb, refresh, { isWishlisted: true });
    seedUserGame(testDb, missing, { isWishlisted: true });

    expect(getGamesForSteamPlaytimeSync(NOW).map((g) => g.title)).toEqual(['Missing', 'Refresh']);
  });
});

describe('miss counting before launch', () => {
  it('does not count a playtime miss against an unreleased game', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Pre-launch', isReleased: false });
    updateGameSteamPlaytime(id, null);
    expect(readGame(id).steamPlaytimeMissCount).toBe(0);
    expect(readGame(id).steamPlaytimeUpdatedAt).toBeTruthy();
  });

  it('still counts a playtime miss for a released game', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Released', isReleased: true });
    updateGameSteamPlaytime(id, null);
    expect(readGame(id).steamPlaytimeMissCount).toBe(1);
  });

  it('does not count an HLTB miss against an unreleased game', () => {
    const pre = seedGame(testDb, { steamAppId: 1, title: 'Pre-launch', isReleased: false });
    const out = seedGame(testDb, { steamAppId: 2, title: 'Released', isReleased: true });
    updateGameHltbData(pre, {}, true);
    updateGameHltbData(out, {}, true);
    expect(readGame(pre).hltbMissCount).toBe(0);
    expect(readGame(out).hltbMissCount).toBe(1);
  });
});

describe('miss counters reset on launch', () => {
  it('updateReleaseStatus clears both counters when a game launches', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Launching', isReleased: false, steamPlaytimeMissCount: 3 });
    setGame(id, { hltbMissCount: 6 });

    updateReleaseStatus(id, { isReleased: true, releaseDate: 'Nov 1, 2026' });

    expect(readGame(id).isReleased).toBe(true);
    expect(readGame(id).steamPlaytimeMissCount).toBe(0);
    expect(readGame(id).hltbMissCount).toBe(0);
  });

  it('updateGameMetadata clears them on launch, and leaves an already-released game alone', () => {
    const launching = seedGame(testDb, { steamAppId: 1, title: 'Launching', isReleased: false, steamPlaytimeMissCount: 3 });
    const released = seedGame(testDb, { steamAppId: 2, title: 'Released', isReleased: true, steamPlaytimeMissCount: 3 });
    setGame(launching, { hltbMissCount: 6 });
    setGame(released, { hltbMissCount: 6 });

    updateGameMetadata(launching, { isReleased: true });
    updateGameMetadata(released, { isReleased: true });

    expect(readGame(launching).steamPlaytimeMissCount).toBe(0);
    expect(readGame(launching).hltbMissCount).toBe(0);
    expect(readGame(released).steamPlaytimeMissCount).toBe(3);
    expect(readGame(released).hltbMissCount).toBe(6);
  });

  it('leaves the counters alone while the game stays unreleased', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Still waiting', isReleased: false, steamPlaytimeMissCount: 2 });
    updateReleaseStatus(id, { isReleased: false, releaseDate: 'Dec 1, 2026' });
    expect(readGame(id).steamPlaytimeMissCount).toBe(2);
  });
});

describe('getGamesForHltbSync young-game retry', () => {
  it('retries a young unmatched game deep in the 90-day backoff', () => {
    // Car Park Capital's HLTB state: six pre-launch misses, last tried Sep 23.
    // The backoff alone would not try again until late December.
    const id = seedGame(testDb, { steamAppId: 3031880, title: 'Car Park Capital', releaseDate: 'Oct 9, 2026', isReleased: true });
    setGame(id, { hltbMissCount: 6, hltbLastUpdated: '2026-10-20T02:00:25.705Z' });
    seedUserGame(testDb, id, { isWishlisted: true });

    expect(getGamesForHltbSync(NOW).map((g) => g.title)).toEqual(['Car Park Capital']);
  });

  it('does not retry an established game outside its backoff', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Old', releaseDate: 'Jun 25, 2024', isReleased: true });
    setGame(id, { hltbMissCount: 6, hltbLastUpdated: '2026-10-20T02:00:25.705Z' });
    seedUserGame(testDb, id, { isWishlisted: true });

    expect(getGamesForHltbSync(NOW)).toEqual([]);
  });

  it('does not list a game twice when both rules match', () => {
    const id = seedGame(testDb, { steamAppId: 1, title: 'Both', releaseDate: 'Oct 9, 2026', isReleased: true });
    setGame(id, { hltbMissCount: 1, hltbLastUpdated: '2026-10-01T00:00:00.000Z' });
    seedUserGame(testDb, id, { isWishlisted: true });

    expect(getGamesForHltbSync(NOW).map((g) => g.title)).toEqual(['Both']);
  });
});

describe('getGamesForMetadataRefresh young-game priority', () => {
  it('puts a young game ahead of older LRU entries', () => {
    const old = seedGame(testDb, {
      steamAppId: 1, title: 'Old', releaseDate: 'Jun 25, 2024', isReleased: true, metadataLastUpdated: '2026-10-25T00:00:00.000Z',
    });
    const young = seedGame(testDb, {
      steamAppId: 2, title: 'Young', releaseDate: 'Oct 9, 2026', isReleased: true, metadataLastUpdated: '2026-10-30T00:00:00.000Z',
    });
    seedUserGame(testDb, old, { isWishlisted: true });
    seedUserGame(testDb, young, { isWishlisted: true });

    expect(getGamesForMetadataRefresh('default', 1, NOW).map((g) => g.title)).toEqual(['Young']);
  });
});
