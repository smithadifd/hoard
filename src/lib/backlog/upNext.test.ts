import { describe, it, expect } from 'vitest';
import {
  bucketForCandidate,
  buildUpNextQueue,
  completionRatio,
  explainPick,
  type UpNextCandidate,
} from './upNext';

function candidate(overrides: Partial<UpNextCandidate> = {}): UpNextCandidate {
  return {
    gameId: overrides.gameId ?? 1,
    title: overrides.title ?? 'Game',
    completionStatus: overrides.completionStatus ?? 'unplayed',
    backlogState: overrides.backlogState ?? null,
    priority: overrides.priority ?? null,
    playtimeMinutes: overrides.playtimeMinutes ?? 0,
    effectiveHours: overrides.effectiveHours ?? null,
    reviewScore: overrides.reviewScore ?? null,
    personalInterest: overrides.personalInterest ?? 3,
    momentum: overrides.momentum ?? 'untouched',
    lastPlayedDaysAgo: overrides.lastPlayedDaysAgo ?? null,
    score: overrides.score ?? 0,
  };
}

describe('completionRatio', () => {
  it('is null without an effective length', () => {
    expect(completionRatio({ playtimeMinutes: 600, effectiveHours: null })).toBeNull();
  });
  it('is fraction of effective hours', () => {
    expect(completionRatio({ playtimeMinutes: 600, effectiveHours: 20 })).toBeCloseTo(0.5);
  });
});

describe('bucketForCandidate', () => {
  it('excludes finished/abandoned/dropped/snoozed games', () => {
    expect(bucketForCandidate(candidate({ completionStatus: 'beaten' }))).toBeNull();
    expect(bucketForCandidate(candidate({ completionStatus: 'completed' }))).toBeNull();
    expect(bucketForCandidate(candidate({ completionStatus: 'abandoned' }))).toBeNull();
    expect(bucketForCandidate(candidate({ backlogState: 'dropped' }))).toBeNull();
    expect(bucketForCandidate(candidate({ backlogState: 'snoozed' }))).toBeNull();
  });

  it('buckets an actively-playing game as continue', () => {
    const c = candidate({ completionStatus: 'playing', playtimeMinutes: 200, momentum: 'playing', effectiveHours: 40 });
    expect(bucketForCandidate(c)).toBe('continue');
  });

  it('buckets a near-complete game as finish-soon (beats continue)', () => {
    const c = candidate({
      completionStatus: 'playing',
      playtimeMinutes: 15 * 60, // 15h
      effectiveHours: 20, // 75% done
      momentum: 'playing',
    });
    expect(bucketForCandidate(c)).toBe('finish-soon');
  });

  it('does not call a barely-started game finish-soon', () => {
    const c = candidate({ playtimeMinutes: 30, effectiveHours: 2, momentum: 'untouched' }); // <60min invested gate
    expect(bucketForCandidate(c)).toBe('start-fresh');
  });

  it('surfaces a forgotten favourite (dormant + invested + worth it) as continue', () => {
    const c = candidate({
      playtimeMinutes: 8 * 60,
      effectiveHours: 40, // only 20% done
      momentum: 'dormant',
      reviewScore: 92,
      personalInterest: 4,
      lastPlayedDaysAgo: 220,
    });
    expect(bucketForCandidate(c)).toBe('continue');
  });

  it('routes an invested, dormant, low-value game to drop', () => {
    const c = candidate({
      playtimeMinutes: 3 * 60,
      effectiveHours: 40,
      momentum: 'dormant',
      reviewScore: 55,
      personalInterest: 2,
      lastPlayedDaysAgo: 300,
    });
    expect(bucketForCandidate(c)).toBe('drop');
  });

  it('buckets an untouched game as start-fresh', () => {
    const c = candidate({ playtimeMinutes: 0, effectiveHours: 12, reviewScore: 88 });
    expect(bucketForCandidate(c)).toBe('start-fresh');
  });
});

describe('explainPick', () => {
  it('finish-soon states hours remaining', () => {
    const c = candidate({ playtimeMinutes: 15 * 60, effectiveHours: 20 });
    expect(explainPick(c, 'finish-soon')).toContain('5h from the finish');
  });
  it('drop calls out the stall', () => {
    const c = candidate({ playtimeMinutes: 180, lastPlayedDaysAgo: 300 });
    expect(explainPick(c, 'drop')).toMatch(/drop it\?$/);
  });
  it('start-fresh mentions review + length', () => {
    const c = candidate({ reviewScore: 90, effectiveHours: 12 });
    const r = explainPick(c, 'start-fresh');
    expect(r).toContain('90%');
    expect(r).toContain('12h');
  });
});

describe('buildUpNextQueue', () => {
  it('caps at maxItems and orders by score', () => {
    const cands = Array.from({ length: 8 }, (_, i) =>
      candidate({ gameId: i + 1, title: `G${i}`, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 80, score: i }),
    );
    const q = buildUpNextQueue(cands, { maxItems: 3 });
    expect(q).toHaveLength(3);
    expect(q[0].score).toBeGreaterThanOrEqual(q[1].score);
  });

  it('seeds diversity: pulls from multiple buckets even when one bucket dominates by score', () => {
    const cands: UpNextCandidate[] = [
      // Three high-scoring start-fresh games...
      candidate({ gameId: 1, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 90, score: 100 }),
      candidate({ gameId: 2, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 90, score: 99 }),
      candidate({ gameId: 3, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 90, score: 98 }),
      // ...and one lower-scoring finish-soon.
      candidate({
        gameId: 9,
        completionStatus: 'playing',
        playtimeMinutes: 15 * 60,
        effectiveHours: 20,
        momentum: 'playing',
        score: 5,
      }),
    ];
    const q = buildUpNextQueue(cands, { maxItems: 3 });
    const buckets = new Set(q.map((i) => i.bucket));
    expect(buckets.has('finish-soon')).toBe(true); // diversity seed pulled it in despite low score
    expect(q.find((i) => i.gameId === 9)).toBeTruthy();
  });

  it('pins a shortlisted pick to the top', () => {
    const cands: UpNextCandidate[] = [
      candidate({ gameId: 1, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 95, score: 100 }),
      candidate({
        gameId: 2,
        playtimeMinutes: 0,
        effectiveHours: 10,
        reviewScore: 50,
        score: 1,
        backlogState: 'shortlisted',
      }),
    ];
    const q = buildUpNextQueue(cands, { maxItems: 5 });
    expect(q[0].gameId).toBe(2); // shortlist beats the higher raw score
  });

  it('omits excluded games entirely', () => {
    const cands: UpNextCandidate[] = [
      candidate({ gameId: 1, completionStatus: 'completed', score: 100 }),
      candidate({ gameId: 2, playtimeMinutes: 0, effectiveHours: 10, reviewScore: 80, score: 1 }),
    ];
    const q = buildUpNextQueue(cands);
    expect(q.map((i) => i.gameId)).toEqual([2]);
  });
});
