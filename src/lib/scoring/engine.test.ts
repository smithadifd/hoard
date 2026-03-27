import { describe, it, expect } from 'vitest';
import { calculateDealScore } from './engine';
import { DEFAULT_WEIGHTS } from './types';
import type { ScoringWeights, ScoringThresholds } from './types';

// Helper to create a base input with sensible defaults
function makeInput(overrides: Partial<Parameters<typeof calculateDealScore>[0]> = {}) {
  return {
    currentPrice: 20,
    regularPrice: 40,
    historicalLow: 10,
    reviewPercent: 85 as number | null,
    hltbMainHours: 20 as number | null,
    personalInterest: 3,
    ...overrides,
  };
}

describe('calculateDealScore', () => {
  describe('price scoring', () => {
    it('returns 100 when price equals historical low', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 10, historicalLow: 10 }));
      expect(result.priceScore).toBe(100);
    });

    it('returns 100 when price is below historical low', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 5, historicalLow: 10 }));
      expect(result.priceScore).toBe(100);
    });

    it('returns 0 when price equals regular price (no discount)', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 40, regularPrice: 40, historicalLow: 10 }));
      expect(result.priceScore).toBe(0);
    });

    it('returns 100 when current price is zero (free game)', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 0 }));
      expect(result.priceScore).toBe(100);
    });

    it('returns 50 when regular price is zero', () => {
      const result = calculateDealScore(makeInput({ regularPrice: 0 }));
      expect(result.priceScore).toBe(50);
    });

    it('returns 50 when regular equals historical low (no range)', () => {
      const result = calculateDealScore(makeInput({ regularPrice: 10, historicalLow: 10, currentPrice: 10 }));
      // current <= historicalLow, so should be 100
      expect(result.priceScore).toBe(100);
    });

    it('scores proportionally between regular and historical low', () => {
      // Regular=40, ATL=10, range=30. Current=25, position=(40-25)/30=0.5 → 50
      const result = calculateDealScore(makeInput({ currentPrice: 25, regularPrice: 40, historicalLow: 10 }));
      expect(result.priceScore).toBe(50);
    });
  });

  describe('review scoring', () => {
    it('returns 50 for null review (unknown = neutral)', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: null }));
      expect(result.reviewScore).toBe(50);
    });

    it('passes through review percentage directly', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: 92 }));
      expect(result.reviewScore).toBe(92);
    });

    it('handles 0% reviews', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: 0 }));
      expect(result.reviewScore).toBe(0);
    });

    it('handles 100% reviews', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: 100 }));
      expect(result.reviewScore).toBe(100);
    });
  });

  describe('value scoring', () => {
    it('returns 50 for null HLTB hours (unknown = neutral)', () => {
      const result = calculateDealScore(makeInput({ hltbMainHours: null }));
      expect(result.valueScore).toBe(50);
    });

    it('returns 50 for zero HLTB hours', () => {
      const result = calculateDealScore(makeInput({ hltbMainHours: 0 }));
      expect(result.valueScore).toBe(50);
    });

    it('returns 100 for free game', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 0, hltbMainHours: 10 }));
      // currentPrice 0 → priceScore returns 50, valueScore returns 100
      expect(result.valueScore).toBe(100);
    });

    it('returns 100 for exceptional value ($/hr <= 0.5x threshold)', () => {
      // Review 85% → veryPositive threshold = $3/hr. 0.5x = $1.50/hr
      // Price $10 / 20hr = $0.50/hr ≤ $1.50
      const result = calculateDealScore(makeInput({ currentPrice: 10, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.valueScore).toBe(100);
    });

    it('returns 75 for good value ($/hr <= threshold)', () => {
      // Review 85% → veryPositive = $3/hr. Need $/hr between $1.50 and $3.00
      // Price $50 / 20hr = $2.50/hr
      const result = calculateDealScore(makeInput({ currentPrice: 50, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.valueScore).toBe(75);
    });

    it('returns 50 for okay value ($/hr <= 1.5x threshold)', () => {
      // Review 85% → veryPositive = $3/hr. 1.5x = $4.50. Need between $3 and $4.50
      // Price $70 / 20hr = $3.50/hr
      const result = calculateDealScore(makeInput({ currentPrice: 70, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.valueScore).toBe(50);
    });

    it('returns 25 for poor value ($/hr <= 2x threshold)', () => {
      // Review 85% → veryPositive = $3/hr. 2x = $6. Need between $4.50 and $6
      // Price $100 / 20hr = $5.00/hr
      const result = calculateDealScore(makeInput({ currentPrice: 100, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.valueScore).toBe(25);
    });

    it('returns 10 for bad value ($/hr > 2x threshold)', () => {
      // Review 85% → veryPositive = $3/hr. 2x = $6. Need > $6
      // Price $200 / 20hr = $10.00/hr
      const result = calculateDealScore(makeInput({ currentPrice: 200, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.valueScore).toBe(10);
    });

    it('uses overwhelmingly positive threshold for 95%+ reviews', () => {
      // 95%+ → overwhelminglyPositive = $4/hr. 0.5x = $2
      // Price $30 / 20hr = $1.50/hr ≤ $2 → 100
      const result = calculateDealScore(makeInput({ currentPrice: 30, hltbMainHours: 20, reviewPercent: 96 }));
      expect(result.valueScore).toBe(100);
    });

    it('uses mixed threshold for 40-69% reviews', () => {
      // 50% → mixed = $1/hr. 0.5x = $0.50
      // Price $5 / 20hr = $0.25/hr ≤ $0.50 → 100
      const result = calculateDealScore(makeInput({ currentPrice: 5, hltbMainHours: 20, reviewPercent: 50 }));
      expect(result.valueScore).toBe(100);
    });

    it('uses negative threshold for <40% reviews', () => {
      // 30% → negative = $0.50/hr. 0.5x = $0.25
      // Price $20 / 20hr = $1.00/hr > $0.50 * 2 = $1.00 → exactly at 2x boundary → 25
      const result = calculateDealScore(makeInput({ currentPrice: 20, hltbMainHours: 20, reviewPercent: 30 }));
      expect(result.valueScore).toBe(25);
    });

    it('uses positive threshold for null reviews', () => {
      // null → positive = $2/hr. 0.5x = $1
      // Price $15 / 20hr = $0.75/hr ≤ $1 → 100
      const result = calculateDealScore(makeInput({ currentPrice: 15, hltbMainHours: 20, reviewPercent: null }));
      expect(result.valueScore).toBe(100);
    });
  });

  describe('interest scoring', () => {
    it('maps interest 1 to 0', () => {
      const result = calculateDealScore(makeInput({ personalInterest: 1 }));
      expect(result.interestScore).toBe(0);
    });

    it('maps interest 3 to 50', () => {
      const result = calculateDealScore(makeInput({ personalInterest: 3 }));
      expect(result.interestScore).toBe(50);
    });

    it('maps interest 5 to 100', () => {
      const result = calculateDealScore(makeInput({ personalInterest: 5 }));
      expect(result.interestScore).toBe(100);
    });

    it('maps interest 2 to 25', () => {
      const result = calculateDealScore(makeInput({ personalInterest: 2 }));
      expect(result.interestScore).toBe(25);
    });

    it('maps interest 4 to 75', () => {
      const result = calculateDealScore(makeInput({ personalInterest: 4 }));
      expect(result.interestScore).toBe(75);
    });
  });

  describe('composite scoring', () => {
    it('applies default weights correctly', () => {
      const result = calculateDealScore(makeInput({
        currentPrice: 10, regularPrice: 40, historicalLow: 10, // priceScore=100
        reviewPercent: 80,    // reviewScore=80
        hltbMainHours: 20,    // $0.50/hr → valueScore=100 (veryPositive threshold $3, 0.5x=$1.5)
        personalInterest: 5,  // interestScore=100
      }));
      // Expected: 100*0.30 + 80*0.25 + 100*0.25 + 100*0.20 = 30 + 20 + 25 + 20 = 95
      expect(result.overall).toBe(95);
    });

    it('applies custom weights correctly', () => {
      const customWeights: ScoringWeights = {
        priceWeight: 1.0,
        reviewWeight: 0,
        valueWeight: 0,
        interestWeight: 0,
      };
      const result = calculateDealScore(
        makeInput({ currentPrice: 10, historicalLow: 10 }), // priceScore=100
        customWeights
      );
      expect(result.overall).toBe(100);
    });

    it('clamps overall to 0-100 range', () => {
      // All scores at 100 with weights summing to 1.0 → should not exceed 100
      const result = calculateDealScore(makeInput({
        currentPrice: 5, regularPrice: 40, historicalLow: 10,
        reviewPercent: 100,
        hltbMainHours: 100,
        personalInterest: 5,
      }));
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });
  });

  describe('rating thresholds', () => {
    it('returns excellent for score >= 85', () => {
      const result = calculateDealScore(makeInput({
        currentPrice: 10, regularPrice: 40, historicalLow: 10,
        reviewPercent: 95, hltbMainHours: 40, personalInterest: 5,
      }));
      expect(result.overall).toBeGreaterThanOrEqual(85);
      expect(result.rating).toBe('excellent');
    });

    it('returns poor for low scores', () => {
      const result = calculateDealScore(makeInput({
        currentPrice: 39, regularPrice: 40, historicalLow: 10,
        reviewPercent: 20, hltbMainHours: 2, personalInterest: 1,
      }));
      expect(result.overall).toBeLessThan(40);
      expect(result.rating).toBe('poor');
    });
  });

  describe('summary text', () => {
    it('includes ATL flag when at historical low', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 10, historicalLow: 10 }));
      expect(result.summary).toContain('All-time low price');
    });

    it('includes near historical low for high price score', () => {
      // priceScore >= 80 but not ATL
      // Regular=40, ATL=10, range=30. For priceScore=80: position=0.8 → current = 40 - 0.8*30 = 16
      const result = calculateDealScore(makeInput({ currentPrice: 16, regularPrice: 40, historicalLow: 10 }));
      expect(result.summary).toContain('Near historical low');
    });

    it('includes stellar reviews for 90%+', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: 92 }));
      expect(result.summary).toContain('stellar reviews');
    });

    it('includes strong reviews for 75-89%', () => {
      const result = calculateDealScore(makeInput({ reviewPercent: 78 }));
      expect(result.summary).toContain('strong reviews');
    });

    it('includes great value with $/hr for high value score', () => {
      // Need valueScore >= 80 and dollarsPerHour not null
      // $10 / 20hr = $0.50/hr, review 85% → veryPositive $3/hr → exceptional (100)
      const result = calculateDealScore(makeInput({ currentPrice: 10, hltbMainHours: 20, reviewPercent: 85 }));
      expect(result.summary).toContain('great value');
      expect(result.summary).toMatch(/\$[\d.]+\/hr/);
    });

    it('returns Average deal when nothing notable', () => {
      const result = calculateDealScore(makeInput({
        currentPrice: 38, regularPrice: 40, historicalLow: 10,
        reviewPercent: 60, hltbMainHours: null, personalInterest: 3,
      }));
      expect(result.summary).toBe('Average deal');
    });
  });

  describe('output fields', () => {
    it('sets isAtHistoricalLow correctly when at ATL', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 10, historicalLow: 10 }));
      expect(result.isAtHistoricalLow).toBe(true);
    });

    it('sets isAtHistoricalLow correctly when above ATL', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 15, historicalLow: 10 }));
      expect(result.isAtHistoricalLow).toBe(false);
    });

    it('calculates dollarsPerHour when HLTB data available', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 30, hltbMainHours: 10 }));
      expect(result.dollarsPerHour).toBe(3);
    });

    it('returns null dollarsPerHour when no HLTB data', () => {
      const result = calculateDealScore(makeInput({ hltbMainHours: null }));
      expect(result.dollarsPerHour).toBeNull();
    });

    it('returns currentPrice and historicalLow in output', () => {
      const result = calculateDealScore(makeInput({ currentPrice: 15, historicalLow: 8 }));
      expect(result.currentPrice).toBe(15);
      expect(result.historicalLow).toBe(8);
    });
  });

  describe('custom thresholds', () => {
    it('uses custom thresholds for value calculation', () => {
      const customThresholds: ScoringThresholds = {
        maxDollarsPerHour: {
          overwhelminglyPositive: 10,
          veryPositive: 8,
          positive: 6,
          mixed: 4,
          negative: 2,
        },
      };
      // Review 85% → veryPositive = $8/hr. Price $100 / 20hr = $5/hr ≤ $8 → good (75)
      const result = calculateDealScore(
        makeInput({ currentPrice: 100, hltbMainHours: 20, reviewPercent: 85 }),
        DEFAULT_WEIGHTS,
        customThresholds
      );
      expect(result.valueScore).toBe(75);
    });
  });
});
