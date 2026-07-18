import { describe, it, expect } from 'vitest';
import { computeDealOutcome, computeDealOutcomesReport, type DealOutcomeInput } from './dealOutcomes';

/** Base fixture — override per test. Defaults to a clean, gradable "hit". */
function makeInput(overrides: Partial<DealOutcomeInput> = {}): DealOutcomeInput {
  return {
    gameId: 1,
    title: 'Test Game',
    pricePaid: 20,
    playtimeMinutes: 1200, // 20h
    playtimeSource: 'hltb',
    hltbMain: 10, // predicted $/hr = 20/10 = 2.00
    steamPlaytimeMedian: null,
    reviewPercent: 90,
    enjoymentRating: null,
    completionStatus: 'unplayed',
    genres: [],
    store: 'steam',
    discountPercent: 50,
    dealScore: 75,
    ...overrides,
  };
}

describe('computeDealOutcome', () => {
  it('hits when realized $/hr is at or below predicted $/hr', () => {
    // 20 played hours against a $20 price → $1.00/hr realized vs $2.00/hr predicted.
    const outcome = computeDealOutcome(makeInput({ playtimeMinutes: 1200, hltbMain: 10, pricePaid: 20 }));
    expect(outcome.predictedDollarsPerHour).toBe(2);
    expect(outcome.realizedDollarsPerHour).toBe(1);
    expect(outcome.verdict).toBe('hit');
  });

  it('hits exactly at the boundary (realized === predicted)', () => {
    // 10h played, $20 paid, 10h HLTB → both sides equal $2.00/hr.
    const outcome = computeDealOutcome(makeInput({ playtimeMinutes: 600, hltbMain: 10, pricePaid: 20 }));
    expect(outcome.predictedDollarsPerHour).toBe(2);
    expect(outcome.realizedDollarsPerHour).toBe(2);
    expect(outcome.verdict).toBe('hit');
  });

  it('misses when realized $/hr exceeds predicted $/hr (played far less than expected)', () => {
    // $60 paid, only 1h played → $60/hr realized vs $6/hr predicted (10h HLTB).
    const outcome = computeDealOutcome(makeInput({ playtimeMinutes: 60, hltbMain: 10, pricePaid: 60 }));
    expect(outcome.predictedDollarsPerHour).toBe(6);
    expect(outcome.realizedDollarsPerHour).toBe(60);
    expect(outcome.verdict).toBe('miss');
  });

  it('is "pending" when the game has not been played yet — not a miss', () => {
    const outcome = computeDealOutcome(makeInput({ playtimeMinutes: 0, hltbMain: 10, pricePaid: 20 }));
    expect(outcome.realizedDollarsPerHour).toBeNull();
    expect(outcome.predictedDollarsPerHour).toBe(2); // expected side is still knowable
    expect(outcome.verdict).toBe('pending');
  });

  it('is "unknown" when played but there is no hours-estimate basis to grade against', () => {
    const outcome = computeDealOutcome(
      makeInput({ playtimeMinutes: 300, hltbMain: null, steamPlaytimeMedian: null, pricePaid: 20 }),
    );
    expect(outcome.predictedDollarsPerHour).toBeNull();
    expect(outcome.realizedDollarsPerHour).not.toBeNull();
    expect(outcome.verdict).toBe('unknown');
  });

  it('falls back to the Steam review-playtime median when HLTB is missing (same basis as getEffectivePlaytimeHours)', () => {
    const outcome = computeDealOutcome(
      makeInput({ hltbMain: null, steamPlaytimeMedian: 8, pricePaid: 24, playtimeMinutes: 600 }),
    );
    // predicted = 24 / 8 = 3.00; realized = 24 / 10h = 2.40 → hit.
    expect(outcome.predictedDollarsPerHour).toBe(3);
    expect(outcome.realizedDollarsPerHour).toBe(2.4);
    expect(outcome.verdict).toBe('hit');
  });

  it('carries enjoymentRating and completionStatus through untouched (display-only, not verdict inputs)', () => {
    const outcome = computeDealOutcome(
      makeInput({ enjoymentRating: 5, completionStatus: 'abandoned', playtimeMinutes: 60, hltbMain: 10, pricePaid: 60 }),
    );
    // A 5-star rating doesn't rescue an efficiency miss — verdict stays a pure $/hr comparison.
    expect(outcome.verdict).toBe('miss');
    expect(outcome.enjoymentRating).toBe(5);
    expect(outcome.completionStatus).toBe('abandoned');
  });

  describe('discount band bucketing', () => {
    it.each([
      [0, '0-24%'],
      [24, '0-24%'],
      [25, '25-49%'],
      [49, '25-49%'],
      [50, '50-74%'],
      [74, '50-74%'],
      [75, '75-100%'],
      [100, '75-100%'],
    ])('%i%% -> %s', (discountPercent, expected) => {
      const outcome = computeDealOutcome(makeInput({ discountPercent }));
      expect(outcome.discountBand).toBe(expected);
    });

    it('is null when no purchase-time discount is known', () => {
      const outcome = computeDealOutcome(makeInput({ discountPercent: null }));
      expect(outcome.discountBand).toBeNull();
    });
  });

  describe('deal-score band bucketing (mirrors getScoreRating in engine.ts)', () => {
    it.each([
      [39, 'Poor'],
      [40, 'Okay'],
      [54, 'Okay'],
      [55, 'Good'],
      [69, 'Good'],
      [70, 'Great'],
      [84, 'Great'],
      [85, 'Excellent'],
      [100, 'Excellent'],
    ])('score %i -> %s', (dealScore, expected) => {
      const outcome = computeDealOutcome(makeInput({ dealScore }));
      expect(outcome.dealScoreBand).toBe(expected);
    });

    it('is null when no purchase-time deal score is known', () => {
      const outcome = computeDealOutcome(makeInput({ dealScore: null }));
      expect(outcome.dealScoreBand).toBeNull();
    });
  });

  it('leaves store/discount/dealScore null when no purchase-time snapshot was found (never fabricated)', () => {
    const outcome = computeDealOutcome(makeInput({ store: null, discountPercent: null, dealScore: null }));
    expect(outcome.store).toBeNull();
    expect(outcome.discountBand).toBeNull();
    expect(outcome.dealScoreBand).toBeNull();
    // The verdict itself is still gradable — the snapshot is metadata for the
    // breakdowns, not an input to the hit/miss comparison.
    expect(outcome.verdict).toBe('hit');
  });
});

describe('computeDealOutcomesReport', () => {
  it('returns all-zero, null-hitRate output for an empty library', () => {
    const report = computeDealOutcomesReport([]);
    expect(report.games).toEqual([]);
    expect(report.overall).toEqual({ key: 'overall', hits: 0, misses: 0, unknown: 0, pending: 0, graded: 0, hitRate: null });
    expect(report.byStore).toEqual([]);
    expect(report.byGenre).toEqual([]);
    expect(report.byDiscountBand).toEqual([]);
    expect(report.byDealScoreBand).toEqual([]);
  });

  it('groups by store, genre, discount band, and deal-score band with correct hit rates', () => {
    const inputs: DealOutcomeInput[] = [
      // Steam, RPG, 50-74% band, Great band -> hit (10h played, $20/10h HLTB = $2/hr predicted; 20h played -> $1/hr realized)
      makeInput({ gameId: 1, title: 'A', store: 'steam', genres: ['RPG'], discountPercent: 60, dealScore: 72, playtimeMinutes: 1200, hltbMain: 10, pricePaid: 20 }),
      // Steam, RPG + Indie, 75-100% band, Excellent band -> miss (played only 1h vs $6/hr predicted target -> $60/hr realized)
      makeInput({ gameId: 2, title: 'B', store: 'steam', genres: ['RPG', 'Indie'], discountPercent: 80, dealScore: 90, playtimeMinutes: 60, hltbMain: 10, pricePaid: 60 }),
      // GOG, Indie, 0-24% band, Poor band -> pending (never played)
      makeInput({ gameId: 3, title: 'C', store: 'gog', genres: ['Indie'], discountPercent: 10, dealScore: 30, playtimeMinutes: 0, hltbMain: 10, pricePaid: 20 }),
      // Unknown store/discount/dealScore (no purchase snapshot found) -> hit
      makeInput({ gameId: 4, title: 'D', store: null, genres: [], discountPercent: null, dealScore: null, playtimeMinutes: 1200, hltbMain: 10, pricePaid: 20 }),
    ];

    const report = computeDealOutcomesReport(inputs);

    expect(report.games).toHaveLength(4);
    expect(report.overall).toMatchObject({ hits: 2, misses: 1, pending: 1, unknown: 0, graded: 3 });
    expect(report.overall.hitRate).toBe(67); // round(2/3 * 100)

    const storeMap = Object.fromEntries(report.byStore.map((e) => [e.key, e]));
    expect(storeMap.steam).toMatchObject({ hits: 1, misses: 1, graded: 2, hitRate: 50 });
    expect(storeMap.gog).toMatchObject({ hits: 0, misses: 0, pending: 1, graded: 0, hitRate: null });
    expect(storeMap.Unknown).toMatchObject({ hits: 1, misses: 0, graded: 1, hitRate: 100 });

    // Multi-genre attribution: game B (miss) counts toward BOTH RPG and Indie.
    const genreMap = Object.fromEntries(report.byGenre.map((e) => [e.key, e]));
    expect(genreMap.RPG).toMatchObject({ hits: 1, misses: 1, graded: 2, hitRate: 50 });
    expect(genreMap.Indie).toMatchObject({ hits: 0, misses: 1, pending: 1, graded: 1, hitRate: 0 });
    // Game D has no genre tags -> bucketed under 'Unknown', not dropped.
    expect(genreMap.Unknown).toMatchObject({ hits: 1, misses: 0, graded: 1, hitRate: 100 });

    // Discount bands come back in canonical low-to-high order (+ Unknown last), not by volume.
    expect(report.byDiscountBand.map((e) => e.key)).toEqual(['0-24%', '50-74%', '75-100%', 'Unknown']);
    const discountMap = Object.fromEntries(report.byDiscountBand.map((e) => [e.key, e]));
    expect(discountMap['50-74%']).toMatchObject({ hits: 1, graded: 1, hitRate: 100 });
    expect(discountMap['75-100%']).toMatchObject({ misses: 1, graded: 1, hitRate: 0 });
    expect(discountMap['0-24%']).toMatchObject({ pending: 1, graded: 0, hitRate: null });

    expect(report.byDealScoreBand.map((e) => e.key)).toEqual(['Excellent', 'Great', 'Poor', 'Unknown']);
  });

  it('never lets pending/unknown games skew a bucket hit rate', () => {
    const inputs: DealOutcomeInput[] = [
      makeInput({ gameId: 1, playtimeMinutes: 0, store: 'steam' }), // pending
      makeInput({ gameId: 2, playtimeMinutes: 300, hltbMain: null, steamPlaytimeMedian: null, store: 'steam' }), // unknown
    ];
    const report = computeDealOutcomesReport(inputs);
    expect(report.overall.graded).toBe(0);
    expect(report.overall.hitRate).toBeNull();
    const steamEntry = report.byStore.find((e) => e.key === 'steam')!;
    expect(steamEntry.pending).toBe(1);
    expect(steamEntry.unknown).toBe(1);
    expect(steamEntry.graded).toBe(0);
    expect(steamEntry.hitRate).toBeNull();
  });
});
