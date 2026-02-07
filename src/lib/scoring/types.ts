/**
 * Value scoring system types.
 *
 * The scoring engine evaluates whether a game is a "good deal"
 * based on configurable weights combining:
 * - Price vs. historical low
 * - Review score
 * - Dollars per hour of gameplay
 * - Personal interest level
 */

export interface ScoringWeights {
  priceWeight: number;      // How much price vs ATL matters (0-1)
  reviewWeight: number;     // How much review score matters (0-1)
  valueWeight: number;      // How much $/hour matters (0-1)
  interestWeight: number;   // How much personal interest matters (0-1)
}

export interface ScoringThresholds {
  // Max $/hour you'd pay for each review tier
  maxDollarsPerHour: {
    overwhelminglyPositive: number; // 95%+
    veryPositive: number;            // 80-94%
    positive: number;                // 70-79%
    mixed: number;                   // 40-69%
    negative: number;                // below 40%
  };
}

export interface DealScore {
  overall: number;          // 0-100 composite score
  priceScore: number;       // 0-100 how close to ATL
  reviewScore: number;      // 0-100 mapped from Steam reviews
  valueScore: number;       // 0-100 based on $/hour thresholds
  interestScore: number;    // 0-100 mapped from 1-5 personal interest

  // Human-readable
  rating: 'excellent' | 'great' | 'good' | 'okay' | 'poor';
  summary: string;          // e.g., "ATL price, stellar reviews, great value"

  // Raw data
  dollarsPerHour: number | null;
  currentPrice: number;
  historicalLow: number;
  isAtHistoricalLow: boolean;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  priceWeight: 0.30,
  reviewWeight: 0.25,
  valueWeight: 0.25,
  interestWeight: 0.20,
};

export const DEFAULT_THRESHOLDS: ScoringThresholds = {
  maxDollarsPerHour: {
    overwhelminglyPositive: 4.00,
    veryPositive: 3.00,
    positive: 2.00,
    mixed: 1.00,
    negative: 0.50,
  },
};
