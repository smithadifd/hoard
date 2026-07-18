/**
 * Deal Outcomes — closes the loop between the purchase-time prediction and the
 * realized result: "was this deal actually worth it, once you played it?"
 *
 * Where Value Received (valueReceived.ts) grades a game against a generic
 * review-tier $/hr ceiling, Deal Outcomes grades a game against the estimate
 * *that specific purchase* implied: pricePaid ÷ the hours-estimate basis you
 * had at the time (HLTB main story, falling back to the Steam review median —
 * the SAME basis resolution `getValueReceivedOverview` and the deal score use,
 * via {@link getEffectivePlaytimeHours}). If you played at least that many
 * hours, the realized $/hr is at or below what you signed up for — a "hit".
 * Play less, and it's a "miss" — an honest, per-game answer to "did the deal
 * pay off", independent of the blended review-tier hit rate already shown on
 * the dashboard (`ValueSummaryCard`).
 *
 * Pure module — no DB, no I/O — mirroring valueReceived.ts/engine.ts. Reuses
 * {@link calculateValueReceived} for the realized $/hr (no new scoring math);
 * this module only derives the purchase-time expectation and aggregates.
 */

import type { ScoringThresholds } from './types';
import { DEFAULT_THRESHOLDS } from './types';
import { getEffectivePlaytimeHours } from './engine';
import { calculateValueReceived } from './valueReceived';

export type DealOutcomeVerdict = 'hit' | 'miss' | 'pending' | 'unknown';

/**
 * Raw per-game facts needed to grade one deal. Sourced from `getDealOutcomeInputs`
 * (db/queries.ts), which joins `user_games` + `games` (for the expected side) with
 * the price_snapshot nearest to (on or before) the purchase date (for store/discount/
 * deal score) and the game's genre tags. Deliberately raw/unresolved (playtimeSource,
 * hltbMain, steamPlaytimeMedian) rather than pre-computed, so this module — not the
 * query layer — owns how "expected hours" gets resolved, exactly like
 * `getValueReceivedOverview` hands raw rows to `calculateValueReceived`.
 */
export interface DealOutcomeInput {
  gameId: number;
  title: string;
  /** USD, always > 0 — callers should only pass priced, owned games. */
  pricePaid: number;
  playtimeMinutes: number;
  playtimeSource: string | null;
  hltbMain: number | null;
  steamPlaytimeMedian: number | null;
  reviewPercent: number | null;
  enjoymentRating: number | null;
  completionStatus: string;
  /** Genre tag names (type='genre'); empty = untagged, bucketed as 'Unknown'. */
  genres: string[];
  /**
   * Purchase-time context, resolved by the query layer from the price_snapshot
   * nearest to (on or before) `pricePaidAt`. All null when no such snapshot exists
   * (e.g. `pricePaidAt` was never stamped, or the game predates price tracking) —
   * the honest boundary: we never guess a store or discount that wasn't observed.
   */
  store: string | null;
  discountPercent: number | null;
  dealScore: number | null;
}

export interface DealOutcome {
  gameId: number;
  title: string;
  pricePaid: number;
  /** pricePaid ÷ expected hours (HLTB main, falling back to the Steam review median). Null = no hours estimate. */
  predictedDollarsPerHour: number | null;
  /** pricePaid ÷ hoursPlayed, from {@link calculateValueReceived}'s money lens. Null until played. */
  realizedDollarsPerHour: number | null;
  enjoymentRating: number | null;
  completionStatus: string;
  genres: string[];
  store: string | null;
  discountPercent: number | null;
  discountBand: string | null;
  dealScore: number | null;
  dealScoreBand: string | null;
  verdict: DealOutcomeVerdict;
}

export interface DealOutcomeBreakdownEntry {
  key: string;
  hits: number;
  misses: number;
  /** Played but no expected-hours basis to grade against (can't tell). */
  unknown: number;
  /** Not played (enough) yet — too early to tell. */
  pending: number;
  /** hits + misses — the denominator for hitRate. */
  graded: number;
  /** hits / graded as a 0-100 percentage, rounded. Null when graded === 0. */
  hitRate: number | null;
}

export interface DealOutcomesReport {
  games: DealOutcome[];
  overall: DealOutcomeBreakdownEntry;
  byStore: DealOutcomeBreakdownEntry[];
  byGenre: DealOutcomeBreakdownEntry[];
  byDiscountBand: DealOutcomeBreakdownEntry[];
  byDealScoreBand: DealOutcomeBreakdownEntry[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Discount bands — simple quartile-ish buckets over the observed 0-100% range.
const DISCOUNT_BANDS: Array<{ label: string; min: number }> = [
  { label: '75-100%', min: 75 },
  { label: '50-74%', min: 50 },
  { label: '25-49%', min: 25 },
  { label: '0-24%', min: 0 },
];
const DISCOUNT_BAND_ORDER = ['0-24%', '25-49%', '50-74%', '75-100%', 'Unknown'];

function discountBandFor(discountPercent: number | null): string | null {
  if (discountPercent == null) return null;
  const band = DISCOUNT_BANDS.find((b) => discountPercent >= b.min);
  return band ? band.label : '0-24%';
}

// Deal-score bands mirror `getScoreRating()` in scoring/engine.ts (85/70/55/40 cutoffs).
// Kept as an explicit local copy rather than importing engine.ts's unexported helper —
// same "thresholds match getScoreRating()" convention already used at
// db/queries.ts's getDealScoreDistribution, so a report-only bucketing choice doesn't
// widen engine.ts's public surface.
const DEAL_SCORE_BAND_ORDER = ['Excellent', 'Great', 'Good', 'Okay', 'Poor', 'Unknown'];

function dealScoreBandFor(dealScore: number | null): string | null {
  if (dealScore == null) return null;
  if (dealScore >= 85) return 'Excellent';
  if (dealScore >= 70) return 'Great';
  if (dealScore >= 55) return 'Good';
  if (dealScore >= 40) return 'Okay';
  return 'Poor';
}

/**
 * Grade a single purchase: expected $/hr (pricePaid over the effective hours
 * estimate) vs realized $/hr (pricePaid over hours actually played, reusing
 * {@link calculateValueReceived}'s money lens — no new $/hr math here).
 *
 * Verdict:
 *  - 'pending' — no hours played yet (money lens needs playtime > 0). Too early
 *    to tell; NOT a miss just because the clock hasn't started.
 *  - 'unknown' — played, but no expected-hours basis exists (no HLTB, no Steam
 *    review median) to know what "expected" even means. Can't grade honestly.
 *  - 'hit' / 'miss' — both sides resolved; realized <= predicted is a hit
 *    (you played through — or past — what the price implied you should).
 */
export function computeDealOutcome(
  input: DealOutcomeInput,
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS as ScoringThresholds,
): DealOutcome {
  const effectiveHours = getEffectivePlaytimeHours({
    playtimeSource: input.playtimeSource,
    hltbMain: input.hltbMain,
    steamPlaytimeMedian: input.steamPlaytimeMedian,
  });

  const vr = calculateValueReceived(
    {
      playtimeMinutes: input.playtimeMinutes,
      hltbMainHours: effectiveHours,
      reviewPercent: input.reviewPercent,
      pricePaid: input.pricePaid,
    },
    thresholds,
  );

  const predictedDollarsPerHour =
    effectiveHours != null && effectiveHours > 0 ? round2(input.pricePaid / effectiveHours) : null;
  const realizedDollarsPerHour = vr.realizedDollarsPerHour;

  let verdict: DealOutcomeVerdict;
  if (realizedDollarsPerHour == null) {
    verdict = 'pending';
  } else if (predictedDollarsPerHour == null) {
    verdict = 'unknown';
  } else {
    verdict = realizedDollarsPerHour <= predictedDollarsPerHour ? 'hit' : 'miss';
  }

  return {
    gameId: input.gameId,
    title: input.title,
    pricePaid: input.pricePaid,
    predictedDollarsPerHour,
    realizedDollarsPerHour,
    enjoymentRating: input.enjoymentRating,
    completionStatus: input.completionStatus,
    genres: input.genres,
    store: input.store,
    discountPercent: input.discountPercent,
    discountBand: discountBandFor(input.discountPercent),
    dealScore: input.dealScore,
    dealScoreBand: dealScoreBandFor(input.dealScore),
    verdict,
  };
}

function emptyEntry(key: string): DealOutcomeBreakdownEntry {
  return { key, hits: 0, misses: 0, unknown: 0, pending: 0, graded: 0, hitRate: null };
}

function tally(entry: DealOutcomeBreakdownEntry, verdict: DealOutcomeVerdict): void {
  if (verdict === 'hit') entry.hits++;
  else if (verdict === 'miss') entry.misses++;
  else if (verdict === 'pending') entry.pending++;
  else entry.unknown++;
  entry.graded = entry.hits + entry.misses;
  entry.hitRate = entry.graded > 0 ? Math.round((entry.hits / entry.graded) * 100) : null;
}

/** Group by an arbitrary (possibly multi-valued) key, sorted by graded volume desc. */
function groupBy(games: DealOutcome[], keysFor: (g: DealOutcome) => string[]): DealOutcomeBreakdownEntry[] {
  const map = new Map<string, DealOutcomeBreakdownEntry>();
  for (const g of games) {
    for (const key of keysFor(g)) {
      const entry = map.get(key) ?? emptyEntry(key);
      tally(entry, g.verdict);
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.graded - a.graded || a.key.localeCompare(b.key));
}

/** Group by a single key, ordered by the given canonical band order (bands with no data omitted). */
function groupByOrdered(
  games: DealOutcome[],
  keyFor: (g: DealOutcome) => string,
  order: string[],
): DealOutcomeBreakdownEntry[] {
  const map = new Map<string, DealOutcomeBreakdownEntry>();
  for (const g of games) {
    const key = keyFor(g);
    const entry = map.get(key) ?? emptyEntry(key);
    tally(entry, g.verdict);
    map.set(key, entry);
  }
  return order.filter((key) => map.has(key)).map((key) => map.get(key)!);
}

/**
 * Build the full report: per-game verdicts plus the overall and per-dimension
 * hit-rate breakdowns (store, genre, discount depth, deal-score band).
 *
 * A game with several genre tags counts toward EACH genre's bucket (matching
 * `getGenreDistribution`'s existing multi-attribution convention), so per-genre
 * totals can sum to more than the game count — by design, not a bug.
 */
export function computeDealOutcomesReport(
  inputs: DealOutcomeInput[],
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS as ScoringThresholds,
): DealOutcomesReport {
  const games = inputs.map((input) => computeDealOutcome(input, thresholds));

  const overall = emptyEntry('overall');
  for (const g of games) tally(overall, g.verdict);

  return {
    games,
    overall,
    byStore: groupBy(games, (g) => [g.store ?? 'Unknown']),
    byGenre: groupBy(games, (g) => (g.genres.length > 0 ? g.genres : ['Unknown'])),
    byDiscountBand: groupByOrdered(games, (g) => g.discountBand ?? 'Unknown', DISCOUNT_BAND_ORDER),
    byDealScoreBand: groupByOrdered(games, (g) => g.dealScoreBand ?? 'Unknown', DEAL_SCORE_BAND_ORDER),
  };
}
