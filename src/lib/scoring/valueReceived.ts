/**
 * Value Received — backward-looking value scoring for OWNED games.
 *
 * The mirror of the forward-looking deal score (engine.ts). Where the deal
 * score asks "is this a good price to buy?", Value Received asks "have I
 * received — or exceeded — the expected value from a game I already own?"
 *
 * Two lenses:
 *  - time (default): completion ratio = hoursPlayed / hltbMain. Needs no price,
 *    so the whole library scores with zero user input.
 *  - money (when the user records a price AND has playtime): realized $/hr,
 *    graded against the SAME per-review-tier thresholds the deal score uses
 *    (reuses getMaxDollarsPerHour so the numbers never drift apart).
 *
 * Pure module — no DB, no I/O — so it tests exactly like engine.ts.
 */

import type { ScoringThresholds } from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { getMaxDollarsPerHour } from './engine';

export type ValueReceivedTier = 'unrealized' | 'approaching' | 'realized' | 'exceeded';
// 'none' = no honest baseline to grade against (played, but no HLTB estimate and no price).
export type ValueReceivedLens = 'time' | 'money' | 'none';

export interface ValueReceivedInput {
  playtimeMinutes: number;       // user_games.playtimeMinutes (0 = never played)
  hltbMainHours: number | null;  // games.hltbMain (HOURS)
  reviewPercent: number | null;  // games.reviewScore (0-100) — selects the $/hr tier
  pricePaid: number | null;      // user_games.pricePaid (USD); null/<=0 → time lens only
}

export interface ValueReceivedScore {
  tier: ValueReceivedTier;
  lens: ValueReceivedLens;
  completionRatio: number;                 // hoursPlayed / hltbMain (NOT clamped; 0 when no HLTB)
  hoursPlayed: number;                     // playtimeMinutes / 60, 1dp
  realizedDollarsPerHour: number | null;   // pricePaid / hoursPlayed; null if no price or 0h played
  hoursToBreakEven: number | null;         // pricePaid / tierThreshold; null if no price
  receivedExpectedValue: boolean | null;   // money lens: realized $/hr <= threshold; null on time lens
  summary: string;
}

// Time-lens completion-ratio bands (fraction of HLTB main story).
const TIME_EXCEEDED = 1.1;
const TIME_REALIZED = 0.8;   // 80%+ of an estimate ≈ "beat it" (HLTB is an estimate, not gospel)
const TIME_APPROACHING = 0.2;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

const TIER_LABEL: Record<ValueReceivedTier, string> = {
  exceeded: 'Value Exceeded',
  realized: 'Value Realized',
  approaching: 'Approaching',
  unrealized: 'Unrealized',
};

const TIME_PHRASE: Record<ValueReceivedTier, string> = {
  exceeded: 'value exceeded',
  realized: 'value realized',
  approaching: 'value building',
  unrealized: 'barely started',
};

const MONEY_PHRASE: Record<ValueReceivedTier, string> = {
  exceeded: 'well past expected value',
  realized: 'expected value reached',
  approaching: 'approaching expected value',
  unrealized: 'below expected value so far',
};

export function valueReceivedTierLabel(tier: ValueReceivedTier): string {
  return TIER_LABEL[tier];
}

export function calculateValueReceived(
  input: ValueReceivedInput,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS as ScoringThresholds
): ValueReceivedScore {
  const rawHours = Math.max(0, input.playtimeMinutes) / 60;
  const hoursPlayed = round1(rawHours);
  const hasHltb = input.hltbMainHours !== null && input.hltbMainHours > 0;
  const hasPrice = input.pricePaid !== null && input.pricePaid > 0;
  const rawRatio = hasHltb ? rawHours / (input.hltbMainHours as number) : 0;
  const completionRatio = round2(rawRatio);

  // Break-even hours are informational and defined whenever a price is set,
  // independent of playtime (the hours you'd need to "earn out" what you paid).
  const tierThreshold = getMaxDollarsPerHour(input.reviewPercent, thresholds);
  const hoursToBreakEven = hasPrice ? round1((input.pricePaid as number) / tierThreshold) : null;

  // --- Money lens: a real price AND real playtime (else $/hr is undefined) ---
  if (hasPrice && rawHours > 0) {
    const rawDph = (input.pricePaid as number) / rawHours;
    const tier = moneyTier(rawDph, tierThreshold);
    const realizedDollarsPerHour = round2(rawDph);
    return {
      tier,
      lens: 'money',
      completionRatio,
      hoursPlayed,
      realizedDollarsPerHour,
      hoursToBreakEven,
      receivedExpectedValue: rawDph <= tierThreshold,
      summary: `$${realizedDollarsPerHour.toFixed(2)}/hr — ${MONEY_PHRASE[tier]}`,
    };
  }

  // --- No baseline: played, but no HLTB estimate and no price to grade against ---
  // Inventing a tier here ("Approaching" off 15 min, "Exceeded" off raw hours) was
  // misleading, so report a neutral played-hours result instead. The UI branches on
  // `lens === 'none'`, not the (inert) tier.
  if (rawHours > 0 && !hasHltb) {
    return {
      tier: 'unrealized',
      lens: 'none',
      completionRatio,
      hoursPlayed,
      realizedDollarsPerHour: null,
      hoursToBreakEven, // null here (no price), kept for shape parity
      receivedExpectedValue: null,
      summary: noBaselineSummary(hoursPlayed),
    };
  }

  // --- Time lens (default): never-played, free games, or no recorded price (with HLTB) ---
  const tier: ValueReceivedTier = rawHours <= 0 ? 'unrealized' : timeTier(rawRatio);

  return {
    tier,
    lens: 'time',
    completionRatio,
    hoursPlayed,
    realizedDollarsPerHour: null,
    hoursToBreakEven, // may be non-null when a price is set but the game is unplayed
    receivedExpectedValue: null,
    summary: timeSummary(tier, rawRatio, hoursPlayed),
  };
}

function moneyTier(dollarsPerHour: number, threshold: number): ValueReceivedTier {
  if (dollarsPerHour <= threshold * 0.5) return 'exceeded';
  if (dollarsPerHour <= threshold) return 'realized';
  if (dollarsPerHour <= threshold * 2) return 'approaching';
  return 'unrealized';
}

function timeTier(ratio: number): ValueReceivedTier {
  if (ratio >= TIME_EXCEEDED) return 'exceeded';
  if (ratio >= TIME_REALIZED) return 'realized';
  if (ratio >= TIME_APPROACHING) return 'approaching';
  return 'unrealized';
}

function timeSummary(tier: ValueReceivedTier, ratio: number, hoursPlayed: number): string {
  if (hoursPlayed <= 0) return 'Never played — value unrealized';
  return `${Math.round(ratio * 100)}% of main story — ${TIME_PHRASE[tier]}`;
}

function noBaselineSummary(hoursPlayed: number): string {
  const h = hoursPlayed === 1 ? '1 hour' : `${hoursPlayed} hours`;
  return `${h} played — add a duration or price to grade value`;
}
