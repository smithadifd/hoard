import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import {
  REVIEW_TIER_LADDER,
  NULL_REVIEW_THRESHOLD_KEY,
  maxDollarsPerHourFor,
  buildDphTargetSql,
} from './reviewTierLadder';
import { DEFAULT_THRESHOLDS, type ScoringThresholds } from './types';
import { getMaxDollarsPerHour } from './engine';

// A non-default threshold set, to prove the pin holds for user-configured values
// too (not just the defaults baked into the ladder shape).
const CUSTOM: ScoringThresholds = {
  maxDollarsPerHour: {
    overwhelminglyPositive: 9.5,
    veryPositive: 6.25,
    positive: 4,
    mixed: 2.5,
    negative: 1.1,
  },
};

// Sweep the breakpoints and the values on either side of each, plus null.
const REVIEW_PERCENTS: (number | null)[] = [
  null, 0, 39, 40, 41, 69, 70, 79, 80, 94, 95, 96, 100,
];

const dialect = new SQLiteSyncDialect();

/** Evaluate the PROD-generated SQL CASE for a review percent in real SQLite. */
function evalSqlTarget(reviewPercent: number | null, thresholds: ScoringThresholds): number {
  const frag = buildDphTargetSql(sql`${reviewPercent}`, thresholds.maxDollarsPerHour);
  const { sql: text, params } = dialect.sqlToQuery(frag);
  const db = new Database(':memory:');
  try {
    const row = db.prepare(`SELECT ${text} AS v`).get(...params) as { v: number };
    return row.v;
  } finally {
    db.close();
  }
}

describe('REVIEW_TIER_LADDER — shape', () => {
  it('is ordered high → low and ends at the catch-all rung', () => {
    for (let i = 1; i < REVIEW_TIER_LADDER.length; i++) {
      expect(REVIEW_TIER_LADDER[i].minReviewPercent)
        .toBeLessThan(REVIEW_TIER_LADDER[i - 1].minReviewPercent);
    }
    expect(REVIEW_TIER_LADDER[REVIEW_TIER_LADDER.length - 1].minReviewPercent).toBe(0);
  });

  it('references only real threshold keys', () => {
    const keys = new Set(Object.keys(DEFAULT_THRESHOLDS.maxDollarsPerHour));
    for (const rung of REVIEW_TIER_LADDER) expect(keys.has(rung.thresholdKey)).toBe(true);
    expect(keys.has(NULL_REVIEW_THRESHOLD_KEY)).toBe(true);
  });
});

describe('maxDollarsPerHourFor — locked semantics', () => {
  it('maps each review tier to the expected threshold (defaults)', () => {
    const t = DEFAULT_THRESHOLDS.maxDollarsPerHour;
    expect(maxDollarsPerHourFor(null, DEFAULT_THRESHOLDS)).toBe(t.positive);
    expect(maxDollarsPerHourFor(100, DEFAULT_THRESHOLDS)).toBe(t.overwhelminglyPositive);
    expect(maxDollarsPerHourFor(95, DEFAULT_THRESHOLDS)).toBe(t.overwhelminglyPositive);
    expect(maxDollarsPerHourFor(94, DEFAULT_THRESHOLDS)).toBe(t.veryPositive);
    expect(maxDollarsPerHourFor(80, DEFAULT_THRESHOLDS)).toBe(t.veryPositive);
    expect(maxDollarsPerHourFor(79, DEFAULT_THRESHOLDS)).toBe(t.positive);
    expect(maxDollarsPerHourFor(70, DEFAULT_THRESHOLDS)).toBe(t.positive);
    expect(maxDollarsPerHourFor(69, DEFAULT_THRESHOLDS)).toBe(t.mixed);
    expect(maxDollarsPerHourFor(40, DEFAULT_THRESHOLDS)).toBe(t.mixed);
    expect(maxDollarsPerHourFor(39, DEFAULT_THRESHOLDS)).toBe(t.negative);
    expect(maxDollarsPerHourFor(0, DEFAULT_THRESHOLDS)).toBe(t.negative);
  });

  it('engine.getMaxDollarsPerHour delegates to the shared ladder', () => {
    for (const rp of REVIEW_PERCENTS) {
      expect(getMaxDollarsPerHour(rp, DEFAULT_THRESHOLDS))
        .toBe(maxDollarsPerHourFor(rp, DEFAULT_THRESHOLDS));
    }
  });
});

describe('tier-ladder pin: SQL path === TS path', () => {
  for (const thresholds of [DEFAULT_THRESHOLDS, CUSTOM]) {
    for (const rp of REVIEW_PERCENTS) {
      it(`agrees at reviewPercent=${rp} (${thresholds === CUSTOM ? 'custom' : 'default'})`, () => {
        const tsValue = maxDollarsPerHourFor(rp, thresholds);
        const sqlValue = evalSqlTarget(rp, thresholds);
        expect(sqlValue).toBeCloseTo(tsValue, 10);
      });
    }
  }
});
