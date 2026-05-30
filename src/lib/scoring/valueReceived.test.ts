import { describe, it, expect } from 'vitest';
import { calculateValueReceived, valueReceivedTierLabel } from './valueReceived';

// Base input: 10h played, 10h HLTB main (ratio 1.0 → realized), 85% reviews (VP → $3/hr), no price.
function makeInput(overrides: Partial<Parameters<typeof calculateValueReceived>[0]> = {}) {
  return {
    playtimeMinutes: 600,
    hltbMainHours: 10 as number | null,
    reviewPercent: 85 as number | null,
    pricePaid: null as number | null,
    ...overrides,
  };
}

describe('calculateValueReceived', () => {
  describe('time lens (no price)', () => {
    it('uses the time lens when no price is recorded', () => {
      const r = calculateValueReceived(makeInput());
      expect(r.lens).toBe('time');
      expect(r.realizedDollarsPerHour).toBeNull();
      expect(r.receivedExpectedValue).toBeNull();
      expect(r.hoursToBreakEven).toBeNull();
    });

    // hltbMain = 10h, so playtime drives the ratio directly.
    it('unrealized just below 0.20 of main (114 min → 0.19)', () => {
      expect(calculateValueReceived(makeInput({ playtimeMinutes: 114 })).tier).toBe('unrealized');
    });

    it('approaching at exactly 0.20 of main (120 min)', () => {
      expect(calculateValueReceived(makeInput({ playtimeMinutes: 120 })).tier).toBe('approaching');
    });

    it('approaching just below 0.80 of main (474 min → 0.79)', () => {
      expect(calculateValueReceived(makeInput({ playtimeMinutes: 474 })).tier).toBe('approaching');
    });

    it('realized at exactly 0.80 of main (480 min)', () => {
      expect(calculateValueReceived(makeInput({ playtimeMinutes: 480 })).tier).toBe('realized');
    });

    it('realized just below 1.10 of main (654 min → 1.09)', () => {
      expect(calculateValueReceived(makeInput({ playtimeMinutes: 654 })).tier).toBe('realized');
    });

    it('exceeded at 1.10 of main and beyond (660 min)', () => {
      const r = calculateValueReceived(makeInput({ playtimeMinutes: 660 }));
      expect(r.tier).toBe('exceeded');
      expect(r.completionRatio).toBe(1.1);
      expect(r.hoursPlayed).toBe(11);
    });

    it('never-played is always unrealized with null $/hr', () => {
      const r = calculateValueReceived(makeInput({ playtimeMinutes: 0 }));
      expect(r.tier).toBe('unrealized');
      expect(r.lens).toBe('time');
      expect(r.realizedDollarsPerHour).toBeNull();
      expect(r.completionRatio).toBe(0);
      expect(r.summary).toBe('Never played — value unrealized');
    });

    it('summarizes completion as a percent of main story', () => {
      // 1860 min = 31h, /20h main = 155%
      const r = calculateValueReceived(makeInput({ playtimeMinutes: 1860, hltbMainHours: 20 }));
      expect(r.summary).toBe('155% of main story — value exceeded');
    });
  });

  describe('money lens (price recorded)', () => {
    // reviewPercent 85 → Very Positive → $3/hr threshold.
    it('uses the money lens when price and playtime are present', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 60, playtimeMinutes: 1200 })); // 20h → $3/hr
      expect(r.lens).toBe('money');
      expect(r.realizedDollarsPerHour).toBe(3);
      expect(r.tier).toBe('realized');
      expect(r.receivedExpectedValue).toBe(true);
      expect(r.hoursToBreakEven).toBe(20); // 60 / 3
    });

    it('exceeded at or below half the threshold ($1.50/hr)', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 30, playtimeMinutes: 1200 })); // 20h → $1.50/hr
      expect(r.realizedDollarsPerHour).toBe(1.5);
      expect(r.tier).toBe('exceeded');
      expect(r.receivedExpectedValue).toBe(true);
    });

    it('approaching between 1x and 2x the threshold ($4/hr)', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 60, playtimeMinutes: 900 })); // 15h → $4/hr
      expect(r.realizedDollarsPerHour).toBe(4);
      expect(r.tier).toBe('approaching');
      expect(r.receivedExpectedValue).toBe(false);
    });

    it('unrealized above 2x the threshold ($10/hr)', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 60, playtimeMinutes: 360 })); // 6h → $10/hr
      expect(r.tier).toBe('unrealized');
      expect(r.receivedExpectedValue).toBe(false);
    });

    it('rounds realized $/hr to cents', () => {
      // $24.99 over 41h (2460 min), 96% reviews → OP $4 threshold
      const r = calculateValueReceived({
        playtimeMinutes: 2460,
        hltbMainHours: 22,
        reviewPercent: 96,
        pricePaid: 24.99,
      });
      expect(r.realizedDollarsPerHour).toBe(0.61);
      expect(r.tier).toBe('exceeded');
      expect(r.hoursToBreakEven).toBe(6.2); // 24.99 / 4
    });

    it('selects the $/hr threshold by review tier (fixed $2.50/hr)', () => {
      // pricePaid 50 over 20h (1200 min) → exactly $2.50/hr; grade against each tier.
      const at = (reviewPercent: number | null) =>
        calculateValueReceived({ playtimeMinutes: 1200, hltbMainHours: 10, reviewPercent, pricePaid: 50 }).tier;
      expect(at(96)).toBe('realized');    // OP $4: 2.5 <= 4
      expect(at(85)).toBe('realized');    // VP $3: 2.5 <= 3
      expect(at(75)).toBe('approaching'); // Pos $2: 2 < 2.5 <= 4
      expect(at(null)).toBe('approaching'); // null → Pos $2
      expect(at(50)).toBe('unrealized');  // Mixed $1: 2.5 > 2
      expect(at(30)).toBe('unrealized');  // Neg $0.50
    });
  });

  describe('edge cases', () => {
    it('free game (price 0) falls back to the time lens, never $0/hr', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 0, playtimeMinutes: 1200, hltbMainHours: 10 }));
      expect(r.lens).toBe('time');
      expect(r.realizedDollarsPerHour).toBeNull();
      expect(r.tier).toBe('exceeded'); // 20h / 10h = 2.0
    });

    it('missing HLTB + no price has no honest baseline → lens "none", no faked tier', () => {
      const base = { hltbMainHours: null, reviewPercent: 85 as number | null, pricePaid: null as number | null };
      // Any amount of playtime with neither a duration estimate nor a price can't be graded.
      for (const playtimeMinutes of [10, 300, 600, 1500]) {
        const r = calculateValueReceived({ ...base, playtimeMinutes });
        expect(r.lens).toBe('none');
        expect(r.completionRatio).toBe(0);
        expect(r.realizedDollarsPerHour).toBeNull();
      }
      const r = calculateValueReceived({ ...base, playtimeMinutes: 600 });
      expect(r.summary).toBe('10 hours played — add a duration or price to grade value');
    });

    it('never-played with no HLTB stays "unrealized" on the time lens (not "none")', () => {
      const r = calculateValueReceived({
        hltbMainHours: null,
        reviewPercent: 85,
        pricePaid: null,
        playtimeMinutes: 0,
      });
      expect(r.tier).toBe('unrealized');
      expect(r.lens).toBe('time');
      expect(r.summary).toBe('Never played — value unrealized');
    });

    it('missing HLTB + price still grades via the money lens', () => {
      const r = calculateValueReceived({
        playtimeMinutes: 600, // 10h
        hltbMainHours: null,
        reviewPercent: 85, // $3/hr
        pricePaid: 20,
      });
      expect(r.lens).toBe('money');
      expect(r.realizedDollarsPerHour).toBe(2); // 20 / 10
      expect(r.tier).toBe('realized');
      expect(r.completionRatio).toBe(0);
    });

    it('price set but never played → unrealized, break-even still reported', () => {
      const r = calculateValueReceived(makeInput({ pricePaid: 30, playtimeMinutes: 0 }));
      expect(r.tier).toBe('unrealized');
      expect(r.lens).toBe('time');
      expect(r.realizedDollarsPerHour).toBeNull();
      expect(r.hoursToBreakEven).toBe(10); // 30 / 3
    });
  });

  describe('valueReceivedTierLabel', () => {
    it('maps tiers to human labels', () => {
      expect(valueReceivedTierLabel('exceeded')).toBe('Value Exceeded');
      expect(valueReceivedTierLabel('realized')).toBe('Value Realized');
      expect(valueReceivedTierLabel('approaching')).toBe('Approaching');
      expect(valueReceivedTierLabel('unrealized')).toBe('Unrealized');
    });
  });
});
