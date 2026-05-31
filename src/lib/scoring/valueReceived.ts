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
  // Post-play enjoyment ("the payoff", 1-5). When set, it LEADS the verdict and the
  // efficiency lens (tier/$/hr) is demoted to supporting context. null = unrated.
  enjoymentRating?: number | null;
  // Pre-purchase enthusiasm ("the bet", 1-5) + whether it was explicitly rated.
  // Only used to compute the opportunistic bet→payoff delta (both must be explicit).
  personalInterest?: number | null;
  interestRatedAt?: string | null;
}

// The headline verdict, led by the user's own rating once they've rated a game.
// `qualifier` is the efficiency caveat, present ONLY when it would otherwise be
// misread (rating/efficiency diverge, or a neutral rating). null = clean verdict.
export interface ValueReceivedVerdict {
  headline: string;            // warm, first-person ("Glad I played it")
  qualifier: string | null;    // efficiency caveat ("paid a premium") or null when clean
  ratingLed: true;             // always true — verdict only exists when the game is rated
}

// "Did the bet pay off?" — interest (pre-purchase) vs enjoyment (post-play).
// Only computed when BOTH were explicitly set. Detail-page only.
export interface BetPayoff {
  interest: number;            // personalInterest 1-5
  enjoyment: number;           // enjoymentRating 1-5
  delta: number;               // enjoyment - interest
  label: string;               // "exceeded expectations" | "met expectations" | "fell short"
}

export interface ValueReceivedScore {
  tier: ValueReceivedTier;
  lens: ValueReceivedLens;
  completionRatio: number;                 // hoursPlayed / hltbMain (NOT clamped; 0 when no HLTB)
  hoursPlayed: number;                     // playtimeMinutes / 60, 1dp
  realizedDollarsPerHour: number | null;   // pricePaid / hoursPlayed; null if no price or 0h played
  hoursToBreakEven: number | null;         // pricePaid / tierThreshold; null if no price
  receivedExpectedValue: boolean | null;   // money lens: realized $/hr <= threshold; null on time lens
  summary: string;                         // efficiency-lens phrase (supporting context)
  enjoymentRating: number | null;          // echoed back; null = unrated
  verdict: ValueReceivedVerdict | null;    // rating-led headline; null when unrated
  betPayoff: BetPayoff | null;             // interest→enjoyment delta; null unless both explicit
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

// --- Rating-led verdict (warm, first-person) ---------------------------------
// Headline is driven purely by the user's rating; the efficiency tier only
// supplies a qualifier, and only when it would otherwise be misread.

type VerdictBucket = 'glad' | 'fence' | 'notForMe' | 'regret';

function verdictBucket(rating: number): VerdictBucket {
  if (rating >= 4) return 'glad';
  if (rating === 3) return 'fence';
  if (rating === 2) return 'notForMe';
  return 'regret';
}

const VERDICT_HEADLINE: Record<VerdictBucket, string> = {
  glad: 'Glad I played it',
  fence: 'On the fence',
  notForMe: 'Not for me',
  regret: 'Regret it',
};

/**
 * The efficiency qualifier, shown ONLY when it changes the takeaway:
 *  - loved (4-5) + overpaid → flag the premium (else "great value all round" misreads)
 *  - disliked (1-2) + a steal → soften the regret (else "total waste" misreads)
 *  - neutral (3) → efficiency is the deciding info, so always show it
 * Clean cells (verdict + efficiency agree) return null.
 * `moneyTier` is null when there's no money lens (no price), so no qualifier.
 */
function verdictQualifier(bucket: VerdictBucket, moneyTier: ValueReceivedTier | null): string | null {
  if (moneyTier === null) return null;
  switch (bucket) {
    case 'glad':
      if (moneyTier === 'approaching') return 'paid up for it';
      if (moneyTier === 'unrealized') return 'paid a premium';
      return null;
    case 'fence':
      if (moneyTier === 'exceeded') return 'but cheap';
      if (moneyTier === 'approaching') return 'and pricey';
      if (moneyTier === 'unrealized') return 'and you overpaid';
      return null;
    case 'notForMe':
    case 'regret':
      if (moneyTier === 'exceeded') return 'at least it was cheap';
      return null;
  }
}

/** Build the rating-led verdict. `moneyTier` null when no money lens applies. */
export function formatVerdict(rating: number, moneyTier: ValueReceivedTier | null): ValueReceivedVerdict {
  const bucket = verdictBucket(rating);
  return {
    headline: VERDICT_HEADLINE[bucket],
    qualifier: verdictQualifier(bucket, moneyTier),
    ratingLed: true,
  };
}

/** Verdict headline + qualifier as one display string, e.g. "Glad I played it · paid a premium". */
export function verdictText(verdict: ValueReceivedVerdict): string {
  return verdict.qualifier ? `${verdict.headline} · ${verdict.qualifier}` : verdict.headline;
}

/**
 * "Did the bet pay off?" — only when interest was explicitly rated AND the game
 * has a post-play rating. Returns null otherwise (the back-catalog default-3
 * interest is never treated as a real bet).
 */
export function computeBetPayoff(input: ValueReceivedInput): BetPayoff | null {
  const enjoyment = input.enjoymentRating;
  const interest = input.personalInterest;
  if (enjoyment == null || interest == null || !input.interestRatedAt) return null;
  const delta = enjoyment - interest;
  const label = delta >= 1 ? 'exceeded expectations' : delta <= -1 ? 'fell short' : 'met expectations';
  return { interest, enjoyment, delta, label };
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

  // Rating leads the verdict when present; efficiency lens below only supplies the qualifier.
  const rating = input.enjoymentRating ?? null;
  const betPayoff = computeBetPayoff(input);

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
      enjoymentRating: rating,
      verdict: rating !== null ? formatVerdict(rating, tier) : null,
      betPayoff,
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
      enjoymentRating: rating,
      // A rating rescues the no-baseline case: no money lens → no qualifier.
      verdict: rating !== null ? formatVerdict(rating, null) : null,
      betPayoff,
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
    enjoymentRating: rating,
    // Time lens has no $/hr efficiency tier, so the rating-led verdict carries no qualifier.
    verdict: rating !== null ? formatVerdict(rating, null) : null,
    betPayoff,
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
