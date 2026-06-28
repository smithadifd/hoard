/**
 * Value Scoring Engine
 *
 * Calculates a composite "deal score" for a game based on
 * configurable weights and thresholds. Higher score = better deal.
 *
 * Factors:
 * 1. Price Score: How close is the current price to the all-time low?
 * 2. Review Score: How well reviewed is the game?
 * 3. Value Score: Is the $/hour within acceptable range for the review tier?
 * 4. Interest Score: How much does the user want this game?
 */

import type {
  ScoringWeights,
  ScoringThresholds,
  DealScore,
} from './types';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './types';
import type { PlaytimeSource } from '@/lib/playtimeSource';

export type { PlaytimeSource };

interface ScoringInput {
  currentPrice: number;
  regularPrice: number;
  historicalLow: number;
  reviewPercent: number | null;    // 0-100
  reviewDescription?: string;
  hltbMainHours: number | null;
  personalInterest: number;        // 1-5
}

export interface EffectivePlaytimeInput {
  playtimeSource: PlaytimeSource | string | null | undefined;
  hltbMain: number | null | undefined;
  steamPlaytimeMedian: number | null | undefined;
  /**
   * Release status. When explicitly `false` (a not-yet-released game), the
   * automatic HLTB→reviews fallback is suppressed — we don't borrow review-hour
   * data for a game that isn't out, since any "playtime" would be noise. An
   * *explicit* steam_reviews preference is still honoured regardless. `true`/
   * `null`/`undefined` (released, or unknown — including Early Access) allow the
   * fallback.
   */
  isReleased?: boolean | null;
}

/**
 * Resolve which playtime basis actually drives $/hour for a game, plus the hours
 * it yields. Single source of truth so scoring and the UI can never disagree.
 *
 * - An explicit `steam_reviews` choice always uses the median (falling back to
 *   HLTB only if no median exists yet).
 * - The default (`hltb`) prefers HLTB, then falls back to the review median when
 *   HLTB is missing — but only for released games (see `isReleased`).
 *
 * Returns `{ source: null, hours: null }` when no usable playtime is available.
 */
export function resolveEffectivePlaytime(input: EffectivePlaytimeInput): {
  source: PlaytimeSource | null;
  hours: number | null;
} {
  const hltb = input.hltbMain ?? null;
  const steam = input.steamPlaytimeMedian ?? null;

  if (input.playtimeSource === 'steam_reviews') {
    if (steam != null) return { source: 'steam_reviews', hours: steam };
    return hltb != null ? { source: 'hltb', hours: hltb } : { source: null, hours: null };
  }

  // Default 'hltb' preference.
  if (hltb != null) return { source: 'hltb', hours: hltb };
  if (input.isReleased === false) return { source: null, hours: null };
  return steam != null ? { source: 'steam_reviews', hours: steam } : { source: null, hours: null };
}

/**
 * The playtime (hours) that should feed $/hour scoring for a game. Thin wrapper
 * over {@link resolveEffectivePlaytime}.
 */
export function getEffectivePlaytimeHours(input: EffectivePlaytimeInput): number | null {
  return resolveEffectivePlaytime(input).hours;
}

/**
 * Which source actually drives $/hour for a game ('hltb' | 'steam_reviews'), or
 * null when no usable playtime exists. Used by the UI to label the real basis
 * honestly even when it differs from the stored preference (e.g. an HLTB-less
 * game falling back to reviews). Thin wrapper over {@link resolveEffectivePlaytime}.
 */
export function getEffectivePlaytimeSource(input: EffectivePlaytimeInput): PlaytimeSource | null {
  return resolveEffectivePlaytime(input).source;
}

export function calculateDealScore(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS as ScoringWeights,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS as ScoringThresholds
): DealScore {
  const priceScore = calculatePriceScore(input.currentPrice, input.historicalLow, input.regularPrice);
  const reviewScore = calculateReviewScore(input.reviewPercent);
  const valueScore = calculateValueScore(
    input.currentPrice,
    input.hltbMainHours,
    input.reviewPercent,
    thresholds
  );
  const interestScore = calculateInterestScore(input.personalInterest);

  // Weighted composite
  const rawOverall = Math.round(
    priceScore * weights.priceWeight +
    reviewScore * weights.reviewWeight +
    valueScore * weights.valueWeight +
    interestScore * weights.interestWeight
  );
  const overall = Math.min(100, Math.max(0, rawOverall));

  const dollarsPerHour = input.hltbMainHours && input.hltbMainHours > 0
    ? input.currentPrice / input.hltbMainHours
    : null;

  const isAtHistoricalLow = input.currentPrice <= input.historicalLow;

  return {
    overall,
    priceScore,
    reviewScore,
    valueScore,
    interestScore,
    rating: getScoreRating(overall),
    summary: generateSummary(priceScore, reviewScore, valueScore, isAtHistoricalLow, dollarsPerHour),
    dollarsPerHour,
    currentPrice: input.currentPrice,
    historicalLow: input.historicalLow,
    isAtHistoricalLow,
  };
}

function calculatePriceScore(current: number, historicalLow: number, regular: number): number {
  if (current <= 0) return 100; // Free game = best possible price
  if (regular <= 0) return 50;
  if (current <= historicalLow) return 100;

  // Score based on how close to historical low vs regular price.
  // When current > regular (stale data), position is negative — clamp to [0, 100]
  // so the individual priceScore field is never negative.
  const range = regular - historicalLow;
  if (range <= 0) return 50;

  const position = (regular - current) / range;
  return Math.min(100, Math.max(0, Math.round(position * 100)));
}

function calculateReviewScore(reviewPercent: number | null): number {
  if (reviewPercent === null) return 50; // Unknown = neutral
  return reviewPercent;
}

function calculateValueScore(
  price: number,
  hltbHours: number | null,
  reviewPercent: number | null,
  thresholds: ScoringThresholds
): number {
  if (!hltbHours || hltbHours <= 0) return 50; // Unknown = neutral
  if (price <= 0) return 100; // Free game = perfect value

  const dollarsPerHour = price / hltbHours;
  const maxAcceptable = getMaxDollarsPerHour(reviewPercent, thresholds);

  if (dollarsPerHour <= maxAcceptable * 0.5) return 100; // Exceptional value
  if (dollarsPerHour <= maxAcceptable) return 75; // Good value
  if (dollarsPerHour <= maxAcceptable * 1.5) return 50; // Okay value
  if (dollarsPerHour <= maxAcceptable * 2) return 25; // Poor value
  return 10; // Bad value
}

function calculateInterestScore(interest: number): number {
  // Map 1-5 scale to 0-100
  return Math.round(((interest - 1) / 4) * 100);
}

export function getMaxDollarsPerHour(reviewPercent: number | null, thresholds: ScoringThresholds): number {
  if (reviewPercent === null) return thresholds.maxDollarsPerHour.positive;
  if (reviewPercent >= 95) return thresholds.maxDollarsPerHour.overwhelminglyPositive;
  if (reviewPercent >= 80) return thresholds.maxDollarsPerHour.veryPositive;
  if (reviewPercent >= 70) return thresholds.maxDollarsPerHour.positive;
  if (reviewPercent >= 40) return thresholds.maxDollarsPerHour.mixed;
  return thresholds.maxDollarsPerHour.negative;
}

function getScoreRating(score: number): DealScore['rating'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'great';
  if (score >= 55) return 'good';
  if (score >= 40) return 'okay';
  return 'poor';
}

function generateSummary(
  priceScore: number,
  reviewScore: number,
  valueScore: number,
  isATL: boolean,
  dollarsPerHour: number | null
): string {
  const parts: string[] = [];

  if (isATL) parts.push('All-time low price');
  else if (priceScore >= 80) parts.push('Near historical low');
  else if (priceScore >= 60) parts.push('Good discount');

  if (reviewScore >= 90) parts.push('stellar reviews');
  else if (reviewScore >= 75) parts.push('strong reviews');

  if (valueScore >= 80 && dollarsPerHour !== null) {
    parts.push(`great value ($${dollarsPerHour.toFixed(2)}/hr)`);
  }

  return parts.length > 0 ? parts.join(', ') : 'Average deal';
}
