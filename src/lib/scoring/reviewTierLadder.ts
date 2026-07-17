/**
 * The review-tier → max-$/hour ladder — the SINGLE source of truth shared by
 * the TS scoring path and the SQL data-access path.
 *
 * A game's review percentage picks how much you'd pay per hour before the deal
 * stops being "worth it": stellar reviews justify a higher $/hr, weak reviews a
 * lower one. This ladder used to be written out twice — as an `if` cascade in
 * `scoring/engine.ts` (`getMaxDollarsPerHour`) and again as a raw SQL `CASE` in
 * `db/queries.ts` (the Value-Received tier filter). Two copies of the same
 * breakpoints drift silently. Both now derive from `REVIEW_TIER_LADDER` here:
 * the TS path calls {@link maxDollarsPerHourFor}, the SQL path calls
 * {@link buildDphTargetSql}. `reviewTierLadder.test.ts` pins the two together by
 * executing the generated SQL in SQLite and asserting it equals the TS output.
 */

import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ScoringThresholds } from './types';

export type DphThresholdKey = keyof ScoringThresholds['maxDollarsPerHour'];

export interface ReviewTierRung {
  /** Inclusive lower bound of `reviewPercent` for this rung. */
  readonly minReviewPercent: number;
  /** Which `maxDollarsPerHour` threshold this rung selects. */
  readonly thresholdKey: DphThresholdKey;
}

/**
 * Ordered high → low. The first rung whose `minReviewPercent` is `<=` the game's
 * review percentage wins. The final rung (0) is the catch-all / SQL `ELSE`.
 */
export const REVIEW_TIER_LADDER: readonly ReviewTierRung[] = [
  { minReviewPercent: 95, thresholdKey: 'overwhelminglyPositive' },
  { minReviewPercent: 80, thresholdKey: 'veryPositive' },
  { minReviewPercent: 70, thresholdKey: 'positive' },
  { minReviewPercent: 40, thresholdKey: 'mixed' },
  { minReviewPercent: 0, thresholdKey: 'negative' },
] as const;

/** A game with unknown reviews (`null`) is graded at the `positive` tier. */
export const NULL_REVIEW_THRESHOLD_KEY: DphThresholdKey = 'positive';

/** The rung the SQL `ELSE` branch and the TS fall-through both resolve to. */
const ELSE_THRESHOLD_KEY: DphThresholdKey =
  REVIEW_TIER_LADDER[REVIEW_TIER_LADDER.length - 1].thresholdKey;

/**
 * Max acceptable $/hour for a game, given its review percentage and the user's
 * configured thresholds. The TS scoring path (`getMaxDollarsPerHour`) delegates
 * here.
 */
export function maxDollarsPerHourFor(
  reviewPercent: number | null,
  thresholds: ScoringThresholds,
): number {
  const t = thresholds.maxDollarsPerHour;
  if (reviewPercent === null) return t[NULL_REVIEW_THRESHOLD_KEY];
  for (const rung of REVIEW_TIER_LADDER) {
    if (reviewPercent >= rung.minReviewPercent) return t[rung.thresholdKey];
  }
  // Unreachable while the ladder ends at `minReviewPercent: 0`; kept so the
  // function is total even if the ladder is ever edited.
  return t[ELSE_THRESHOLD_KEY];
}

/**
 * Build the SQL `CASE` expression that mirrors {@link maxDollarsPerHourFor} for
 * a review-score column, generated from the SAME `REVIEW_TIER_LADDER` so the SQL
 * and TS paths cannot drift. Used by the Value-Received tier filter in
 * `db/queries.ts`.
 *
 * @param reviewScoreCol the review-score column (or any SQL expr) to grade
 * @param dph the user's live `maxDollarsPerHour` thresholds
 */
export function buildDphTargetSql(
  reviewScoreCol: SQLWrapper,
  dph: ScoringThresholds['maxDollarsPerHour'],
): SQL {
  const whenClauses = REVIEW_TIER_LADDER
    // The 0 rung is the SQL `ELSE`, so it gets no explicit `WHEN`.
    .filter(rung => rung.minReviewPercent > 0)
    .map(
      rung =>
        sql`WHEN ${reviewScoreCol} >= ${rung.minReviewPercent} THEN ${dph[rung.thresholdKey]}`,
    );
  return sql`(CASE WHEN ${reviewScoreCol} IS NULL THEN ${dph[NULL_REVIEW_THRESHOLD_KEY]} ${sql.join(
    whenClauses,
    sql` `,
  )} ELSE ${dph[ELSE_THRESHOLD_KEY]} END)`;
}
