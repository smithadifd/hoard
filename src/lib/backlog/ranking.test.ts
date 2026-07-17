import { describe, it, expect } from 'vitest';
import { scoreCandidate, genreAffinityForTags, type RankingSignals } from './ranking';

function signals(overrides: Partial<RankingSignals> = {}): RankingSignals {
  return {
    personalInterest: overrides.personalInterest ?? 3,
    reviewScore: overrides.reviewScore ?? 80,
    effectiveHours: overrides.effectiveHours ?? 20,
    playtimeMinutes: overrides.playtimeMinutes ?? 0,
    completionStatus: overrides.completionStatus ?? 'unplayed',
    momentum: overrides.momentum ?? 'untouched',
    gainedThisWeekMinutes: overrides.gainedThisWeekMinutes ?? 0,
    gainedThisMonthMinutes: overrides.gainedThisMonthMinutes ?? 0,
    lastPlayedDaysAgo: overrides.lastPlayedDaysAgo ?? null,
    priority: overrides.priority ?? null,
    genreAffinity: overrides.genreAffinity ?? 0,
    dismissalCount: overrides.dismissalCount ?? 0,
    daysSinceLastDismissal: overrides.daysSinceLastDismissal ?? null,
  };
}

describe('scoreCandidate — recency deltas from playtime_snapshots move ranking', () => {
  it('a game with a fresh week of playtime outranks an identical dormant one', () => {
    const active = scoreCandidate(
      signals({ playtimeMinutes: 200, momentum: 'playing', gainedThisWeekMinutes: 120, gainedThisMonthMinutes: 300 }),
    );
    const idle = scoreCandidate(
      signals({ playtimeMinutes: 200, momentum: 'cooling', gainedThisWeekMinutes: 0, gainedThisMonthMinutes: 0 }),
    );
    expect(active.score).toBeGreaterThan(idle.score);
    expect(active.topReason).toBe('active');
  });

  it('more minutes gained this week ⇒ strictly higher score (monotone in the delta)', () => {
    const base = signals({ playtimeMinutes: 300, momentum: 'playing', gainedThisMonthMinutes: 200 });
    const small = scoreCandidate({ ...base, gainedThisWeekMinutes: 20 });
    const big = scoreCandidate({ ...base, gainedThisWeekMinutes: 120 });
    expect(big.score).toBeGreaterThan(small.score);
  });

  it('gives a cooling boost from a month delta when the week is flat', () => {
    const cooling = scoreCandidate(
      signals({ playtimeMinutes: 300, momentum: 'cooling', gainedThisWeekMinutes: 0, gainedThisMonthMinutes: 180 }),
    );
    const flat = scoreCandidate(
      signals({ playtimeMinutes: 300, momentum: 'dormant', gainedThisWeekMinutes: 0, gainedThisMonthMinutes: 0, reviewScore: 50, personalInterest: 2 }),
    );
    expect(cooling.contributions.active).toBeGreaterThan(0);
    expect(cooling.score).toBeGreaterThan(flat.score);
  });
});

describe('scoreCandidate — forgotten favourites (issue #13)', () => {
  it('resurfaces an invested, dormant, well-liked game and scales with dormancy', () => {
    const recentlyIdle = scoreCandidate(
      signals({ playtimeMinutes: 480, momentum: 'dormant', reviewScore: 92, personalInterest: 5, lastPlayedDaysAgo: 40 }),
    );
    const longIdle = scoreCandidate(
      signals({ playtimeMinutes: 480, momentum: 'dormant', reviewScore: 92, personalInterest: 5, lastPlayedDaysAgo: 220 }),
    );
    expect(recentlyIdle.contributions.forgotten).toBeGreaterThan(0);
    expect(longIdle.contributions.forgotten).toBeGreaterThan(recentlyIdle.contributions.forgotten);
    expect(longIdle.topReason).toBe('forgotten-favorite');
  });

  it('does not resurface a dormant game the user never invested in', () => {
    const r = scoreCandidate(
      signals({ playtimeMinutes: 20, momentum: 'dormant', reviewScore: 90, lastPlayedDaysAgo: 200 }),
    );
    expect(r.contributions.forgotten).toBe(0);
  });
});

describe('scoreCandidate — dismissal cooldown', () => {
  it('penalises a just-dismissed game and decays the penalty over time', () => {
    const fresh = scoreCandidate(signals({ dismissalCount: 1, daysSinceLastDismissal: 0 }));
    const old = scoreCandidate(signals({ dismissalCount: 1, daysSinceLastDismissal: 25 }));
    const none = scoreCandidate(signals({ dismissalCount: 0 }));
    expect(fresh.contributions.dismissPenalty).toBeLessThan(0);
    expect(fresh.score).toBeLessThan(old.score);
    expect(old.score).toBeLessThan(none.score);
  });

  it('the penalty fully lapses after the cooldown window', () => {
    const lapsed = scoreCandidate(signals({ dismissalCount: 3, daysSinceLastDismissal: 40 }));
    const none = scoreCandidate(signals({ dismissalCount: 0 }));
    expect(lapsed.contributions.dismissPenalty).toBe(0);
    expect(lapsed.score).toBeCloseTo(none.score);
  });
});

describe('scoreCandidate — interest neutrality', () => {
  it('a default interest of 3 contributes nothing (avoids the static-sort collapse)', () => {
    const r = scoreCandidate(signals({ personalInterest: 3 }));
    expect(r.contributions.interest).toBe(0);
  });
});

describe('genreAffinityForTags', () => {
  it('takes the strongest matching genre, case-insensitively', () => {
    const map = new Map([
      ['rpg', 0.8],
      ['strategy', 0.3],
    ]);
    expect(genreAffinityForTags(['RPG', 'Strategy'], map)).toBeCloseTo(0.8);
    expect(genreAffinityForTags(['Puzzle'], map)).toBe(0);
  });
});
