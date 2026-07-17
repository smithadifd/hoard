import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb, seedGame, seedUserGame } from './test-helpers';
import type { TestDb } from './test-helpers';
import { recommendationEvents } from './schema';

let testDb: TestDb;

vi.mock('./index', async () => {
  const actualSchema = await vi.importActual('./schema');
  return { getDb: () => testDb, schema: actualSchema };
});

import {
  recordRecommendationShown,
  recordRecommendationsShown,
  recordRecommendationAccepted,
  recordRecommendationDismissed,
  getRecommendationStats,
  getUpNextQueue,
  computeGenreAffinity,
} from './queries';

function eventsFor(gameId: number, userId = 'default') {
  return testDb
    .select()
    .from(recommendationEvents)
    .where(and(eq(recommendationEvents.gameId, gameId), eq(recommendationEvents.userId, userId)))
    .all();
}

beforeEach(() => {
  testDb = createTestDb();
});

describe('recordRecommendationShown', () => {
  it('inserts an event and dedupes a same-day repeat', () => {
    const g = seedGame(testDb, { steamAppId: 1, title: 'A' });
    seedUserGame(testDb, g, { isOwned: true });

    const id1 = recordRecommendationShown({ userId: 'default', gameId: g, bucket: 'start-fresh', reason: 'r', score: 10 });
    const id2 = recordRecommendationShown({ userId: 'default', gameId: g, bucket: 'start-fresh', reason: 'r', score: 10 });

    expect(id1).toBe(id2);
    expect(eventsFor(g)).toHaveLength(1);
  });
});

describe('accept / dismiss mark the latest open event', () => {
  it('accepts the most recent un-acted shown event', () => {
    const g = seedGame(testDb, { steamAppId: 2, title: 'B' });
    seedUserGame(testDb, g, { isOwned: true });
    recordRecommendationShown({ userId: 'default', gameId: g, bucket: 'continue', reason: 'r' });

    expect(recordRecommendationAccepted('default', g)).toBe(true);
    expect(eventsFor(g)[0].acceptedAt).toBeTruthy();
  });

  it('dismiss stamps dismissedAt and feeds getRecommendationStats', () => {
    const g = seedGame(testDb, { steamAppId: 3, title: 'C' });
    seedUserGame(testDb, g, { isOwned: true });
    recordRecommendationShown({ userId: 'default', gameId: g, bucket: 'drop', reason: 'r' });

    expect(recordRecommendationDismissed('default', g)).toBe(true);
    const stats = getRecommendationStats('default');
    expect(stats.get(g)?.dismissalCount).toBe(1);
    expect(stats.get(g)?.daysSinceLastDismissal).toBe(0);
  });

  it('returns false when there is no open event to act on', () => {
    const g = seedGame(testDb, { steamAppId: 4, title: 'D' });
    seedUserGame(testDb, g, { isOwned: true });
    expect(recordRecommendationAccepted('default', g)).toBe(false);
  });
});

describe('computeGenreAffinity', () => {
  it('normalises played-genre share to 0..1 against the top genre', () => {
    const rpg = seedGame(testDb, { steamAppId: 10, title: 'RPG' });
    seedUserGame(testDb, rpg, { isOwned: true, playtimeMinutes: 1000 });
    const strat = seedGame(testDb, { steamAppId: 11, title: 'Strat' });
    seedUserGame(testDb, strat, { isOwned: true, playtimeMinutes: 250 });

    // tag both
    const tagRpg = testDb.$client.prepare(`INSERT INTO tags (name, type) VALUES ('RPG','genre')`).run().lastInsertRowid;
    const tagStrat = testDb.$client.prepare(`INSERT INTO tags (name, type) VALUES ('Strategy','genre')`).run().lastInsertRowid;
    testDb.$client.prepare(`INSERT INTO game_tags (game_id, tag_id) VALUES (?, ?)`).run(rpg, tagRpg);
    testDb.$client.prepare(`INSERT INTO game_tags (game_id, tag_id) VALUES (?, ?)`).run(strat, tagStrat);

    const map = computeGenreAffinity('default');
    expect(map.get('rpg')).toBeCloseTo(1);
    expect(map.get('strategy')).toBeCloseTo(0.25);
  });
});

describe('dismissal cooldown moves the Up Next ranking', () => {
  it('a just-dismissed game ranks below an identical un-dismissed one', () => {
    const a = seedGame(testDb, { steamAppId: 20, title: 'Keep', hltbMain: 10, reviewScore: 85 });
    seedUserGame(testDb, a, { isOwned: true, playtimeMinutes: 0 });
    const b = seedGame(testDb, { steamAppId: 21, title: 'Dismissed', hltbMain: 10, reviewScore: 85 });
    seedUserGame(testDb, b, { isOwned: true, playtimeMinutes: 0 });

    // Both start equal in the queue.
    const before = getUpNextQueue('default');
    const aBefore = before.find((e) => e.gameId === a)!;
    const bBefore = before.find((e) => e.gameId === b)!;
    expect(aBefore.score).toBeCloseTo(bBefore.score);

    // Dismiss b — the cooldown penalty should drop its score below a's.
    recordRecommendationShown({ userId: 'default', gameId: b, bucket: 'start-fresh', reason: 'r' });
    recordRecommendationDismissed('default', b);

    const after = getUpNextQueue('default');
    const aAfter = after.find((e) => e.gameId === a)!;
    const bAfter = after.find((e) => e.gameId === b)!;
    expect(bAfter.score).toBeLessThan(aAfter.score);
  });
});

describe('recordRecommendationsShown batches a whole queue', () => {
  it('records every surfaced pick as shown', () => {
    const g1 = seedGame(testDb, { steamAppId: 30, title: 'G1', hltbMain: 5, reviewScore: 80 });
    seedUserGame(testDb, g1, { isOwned: true });
    const g2 = seedGame(testDb, { steamAppId: 31, title: 'G2', hltbMain: 5, reviewScore: 80 });
    seedUserGame(testDb, g2, { isOwned: true });

    const queue = getUpNextQueue('default');
    recordRecommendationsShown('default', queue.map((q) => ({ gameId: q.gameId, bucket: q.bucket, reason: q.reason, score: q.score })));

    expect(eventsFor(g1).length + eventsFor(g2).length).toBe(queue.length);
  });
});
