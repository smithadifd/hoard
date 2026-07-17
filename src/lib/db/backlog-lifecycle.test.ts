import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame } from './test-helpers';
import type { TestDb } from './test-helpers';
import { userGames } from './schema';

let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return {
    getDb: () => testDb,
    schema: actualSchema,
  };
});

// Imported AFTER the mock (mirrors playtime-snapshots.test.ts).
import {
  setCompletionStatus,
  setBacklogState,
  setPriority,
  getEnrichedGames,
} from './queries';

function readRow(gameId: number, userId = 'default') {
  return testDb
    .select()
    .from(userGames)
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .get();
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('setCompletionStatus', () => {
  it('advances status and stamps startedAt on first play', () => {
    const g = seedGame(testDb, { steamAppId: 1, title: 'A' });
    seedUserGame(testDb, g, { isOwned: true });

    const res = setCompletionStatus(g, 'playing', 'default');
    expect(res.ok).toBe(true);

    const row = readRow(g);
    expect(row?.completionStatus).toBe('playing');
    expect(row?.startedAt).toBeTruthy();
    expect(row?.abandonedAt).toBeNull();
  });

  it('stamps abandonedAt on abandon and clears it when revived', () => {
    const g = seedGame(testDb, { steamAppId: 2, title: 'B' });
    seedUserGame(testDb, g, { isOwned: true, completionStatus: 'playing', startedAt: '2026-01-01T00:00:00.000Z' });

    setCompletionStatus(g, 'abandoned', 'default');
    expect(readRow(g)?.abandonedAt).toBeTruthy();

    setCompletionStatus(g, 'playing', 'default');
    expect(readRow(g)?.abandonedAt).toBeNull();
    // startedAt preserved across the round-trip
    expect(readRow(g)?.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects an illegal transition and leaves the row untouched', () => {
    const g = seedGame(testDb, { steamAppId: 3, title: 'C' });
    seedUserGame(testDb, g, { isOwned: true, completionStatus: 'completed' });

    const res = setCompletionStatus(g, 'abandoned', 'default');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('illegal-transition');
    expect(readRow(g)?.completionStatus).toBe('completed');
  });

  it('creates the row when a never-tracked game is marked playing', () => {
    const g = seedGame(testDb, { steamAppId: 4, title: 'D' });
    const res = setCompletionStatus(g, 'playing', 'default');
    expect(res.ok).toBe(true);
    expect(readRow(g)?.completionStatus).toBe('playing');
  });
});

describe('setBacklogState / setPriority', () => {
  it('sets and clears the backlog-state override', () => {
    const g = seedGame(testDb, { steamAppId: 5, title: 'E' });
    seedUserGame(testDb, g, { isOwned: true });

    expect(setBacklogState(g, 'shortlisted', 'default')).toBe(true);
    expect(readRow(g)?.backlogState).toBe('shortlisted');

    expect(setBacklogState(g, null, 'default')).toBe(true);
    expect(readRow(g)?.backlogState).toBeNull();
  });

  it('rejects a bad backlog-state value', () => {
    const g = seedGame(testDb, { steamAppId: 6, title: 'F' });
    seedUserGame(testDb, g, { isOwned: true });
    // @ts-expect-error — deliberately invalid at the boundary
    expect(setBacklogState(g, 'nope', 'default')).toBe(false);
  });

  it('sets a manual priority and rejects negatives', () => {
    const g = seedGame(testDb, { steamAppId: 7, title: 'G' });
    seedUserGame(testDb, g, { isOwned: true });
    expect(setPriority(g, 5, 'default')).toBe(true);
    expect(readRow(g)?.priority).toBe(5);
    expect(setPriority(g, -1, 'default')).toBe(false);
  });
});

describe('completionStatus filter in getEnrichedGames', () => {
  function seedOwned(steamAppId: number, title: string, status: string) {
    const g = seedGame(testDb, { steamAppId, title, reviewScore: 90, hltbMain: 10 });
    seedUserGame(testDb, g, { isOwned: true, completionStatus: status });
    return g;
  }

  it('excludeFinished hides beaten/completed/abandoned', () => {
    seedOwned(10, 'Unplayed', 'unplayed');
    seedOwned(11, 'Playing', 'playing');
    seedOwned(12, 'Beaten', 'beaten');
    seedOwned(13, 'Abandoned', 'abandoned');

    const { games } = getEnrichedGames(
      { view: 'library', excludeFinished: true },
      1,
      50,
      'default',
    );
    const titles = games.map((g) => g.title).sort();
    expect(titles).toEqual(['Playing', 'Unplayed']);
  });

  it('filters to a specific status set', () => {
    seedOwned(20, 'Unplayed', 'unplayed');
    seedOwned(21, 'Beaten', 'beaten');
    seedOwned(22, 'Completed', 'completed');

    const { games } = getEnrichedGames(
      { view: 'library', completionStatus: ['beaten', 'completed'] },
      1,
      50,
      'default',
    );
    expect(games.map((g) => g.title).sort()).toEqual(['Beaten', 'Completed']);
  });

  it('surfaces completionStatus on the enriched game', () => {
    const g = seedOwned(30, 'Solo', 'playing');
    const { games } = getEnrichedGames({ view: 'library' }, 1, 50, 'default');
    const found = games.find((x) => x.id === g);
    expect(found?.completionStatus).toBe('playing');
  });
});
