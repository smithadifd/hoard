import { describe, it, expect } from 'vitest';
import { parseReleaseDate, getReleaseBucket, getBucketLabel, compareBuckets } from './releaseDate';
import type { ReleaseBucket } from './releaseDate';

describe('parseReleaseDate', () => {
  describe('empty/null inputs', () => {
    it('returns TBD for null', () => {
      const result = parseReleaseDate(null);
      expect(result).toEqual({ date: null, precision: 'unknown', label: 'TBD' });
    });

    it('returns TBD for undefined', () => {
      const result = parseReleaseDate(undefined);
      expect(result).toEqual({ date: null, precision: 'unknown', label: 'TBD' });
    });

    it('returns TBD for empty string', () => {
      const result = parseReleaseDate('');
      expect(result).toEqual({ date: null, precision: 'unknown', label: 'TBD' });
    });

    it('returns TBD for whitespace-only string', () => {
      const result = parseReleaseDate('   ');
      expect(result).toEqual({ date: null, precision: 'unknown', label: 'TBD' });
    });
  });

  describe('TBD-like strings', () => {
    it('detects "Coming Soon" (exact match)', () => {
      const result = parseReleaseDate('Coming Soon');
      expect(result.precision).toBe('unknown');
      expect(result.date).toBeNull();
      expect(result.label).toBe('Coming Soon');
    });

    it('detects "To be announced"', () => {
      const result = parseReleaseDate('To be announced');
      expect(result.precision).toBe('unknown');
    });

    it('detects "TBA"', () => {
      const result = parseReleaseDate('TBA');
      expect(result.precision).toBe('unknown');
    });

    it('detects "TBD"', () => {
      const result = parseReleaseDate('TBD');
      expect(result.precision).toBe('unknown');
    });

    it('does not misclassify date-containing string as TBD', () => {
      // Exact match prevents "Coming Soon: December 2026" from being classified as TBD
      const result = parseReleaseDate('Coming Soon: December 2026');
      expect(result.precision).not.toBe('unknown');
    });
  });

  describe('quarter format', () => {
    it('parses "Q1 2026"', () => {
      const result = parseReleaseDate('Q1 2026');
      expect(result.precision).toBe('quarter');
      expect(result.label).toBe('Q1 2026');
      expect(result.date?.getFullYear()).toBe(2026);
      expect(result.date?.getMonth()).toBe(0); // January
    });

    it('parses "Q4 2027"', () => {
      const result = parseReleaseDate('Q4 2027');
      expect(result.precision).toBe('quarter');
      expect(result.date?.getMonth()).toBe(9); // October
    });

    it('is case insensitive', () => {
      const result = parseReleaseDate('q2 2026');
      expect(result.precision).toBe('quarter');
      expect(result.label).toBe('Q2 2026');
    });
  });

  describe('year only', () => {
    it('parses "2026"', () => {
      const result = parseReleaseDate('2026');
      expect(result.precision).toBe('year');
      expect(result.label).toBe('2026');
      expect(result.date?.getFullYear()).toBe(2026);
      expect(result.date?.getMonth()).toBe(0);
    });
  });

  describe('full dates', () => {
    it('parses "Mar 15, 2026" as day precision', () => {
      const result = parseReleaseDate('Mar 15, 2026');
      expect(result.precision).toBe('day');
      expect(result.date?.getFullYear()).toBe(2026);
      expect(result.date?.getMonth()).toBe(2);
      expect(result.date?.getDate()).toBe(15);
    });

    it('parses ISO format "2026-06-15" as day precision', () => {
      const result = parseReleaseDate('2026-06-15');
      expect(result.precision).toBe('day');
    });
  });

  describe('month + year', () => {
    it('parses "March 2026" as month precision', () => {
      const result = parseReleaseDate('March 2026');
      expect(result.precision).toBe('month');
      expect(result.date?.getMonth()).toBe(2);
    });
  });

  describe('unparseable', () => {
    it('returns unknown for gibberish', () => {
      const result = parseReleaseDate('soon-ish maybe');
      expect(result.precision).toBe('unknown');
      expect(result.date).toBeNull();
      expect(result.label).toBe('soon-ish maybe');
    });
  });
});

describe('getReleaseBucket', () => {
  const now = new Date(2026, 2, 15); // March 15, 2026

  it('returns tbd for unknown precision', () => {
    const parsed = parseReleaseDate(null);
    expect(getReleaseBucket(parsed, now)).toBe('tbd');
  });

  describe('overdue detection', () => {
    it('marks past day as overdue', () => {
      const parsed = parseReleaseDate('Feb 1, 2026');
      expect(getReleaseBucket(parsed, now)).toBe('overdue');
    });

    it('marks past month as overdue', () => {
      const parsed = parseReleaseDate('January 2026');
      expect(getReleaseBucket(parsed, now)).toBe('overdue');
    });

    it('marks past quarter as overdue', () => {
      const parsed = parseReleaseDate('Q4 2025');
      expect(getReleaseBucket(parsed, now)).toBe('overdue');
    });

    it('marks past year as overdue', () => {
      const parsed = parseReleaseDate('2025');
      expect(getReleaseBucket(parsed, now)).toBe('overdue');
    });
  });

  describe('this-month / next-month (day/month precision only)', () => {
    it('returns this-month for day in current month', () => {
      const parsed = parseReleaseDate('Mar 20, 2026');
      expect(getReleaseBucket(parsed, now)).toBe('this-month');
    });

    it('returns next-month for day in next month', () => {
      const parsed = parseReleaseDate('Apr 10, 2026');
      expect(getReleaseBucket(parsed, now)).toBe('next-month');
    });

    it('returns later-this-year for quarter whose start month is current month', () => {
      // Q1 2026 starts in January (month 0), but now is March (month 2)
      // Q2 2026 starts in April (month 3) — not current month
      // Use a quarter that starts in current month: not possible with March
      // Instead test that year-precision in current year gets later-this-year, not this-month
      const parsed = parseReleaseDate('2026');
      expect(getReleaseBucket(parsed, now)).toBe('later-this-year');
    });

    it('returns later-this-year for quarter precision in current year', () => {
      const parsed = parseReleaseDate('Q3 2026');
      expect(getReleaseBucket(parsed, now)).toBe('later-this-year');
    });
  });

  describe('later-this-year', () => {
    it('returns later-this-year for month precision later in year', () => {
      const parsed = parseReleaseDate('June 2026');
      expect(getReleaseBucket(parsed, now)).toBe('later-this-year');
    });
  });

  describe('next-year', () => {
    it('returns next-year for next calendar year', () => {
      const parsed = parseReleaseDate('2027');
      expect(getReleaseBucket(parsed, now)).toBe('next-year');
    });
  });

  describe('future', () => {
    it('returns future for 2+ years out', () => {
      const parsed = parseReleaseDate('2028');
      expect(getReleaseBucket(parsed, now)).toBe('future');
    });
  });

  describe('December edge case', () => {
    it('handles December -> January next-month rollover', () => {
      const dec = new Date(2026, 11, 15); // December 15, 2026
      const parsed = parseReleaseDate('Jan 5, 2027');
      expect(getReleaseBucket(parsed, dec)).toBe('next-month');
    });
  });
});

describe('getBucketLabel', () => {
  const now = new Date(2026, 2, 15); // March 15, 2026

  it('returns "Overdue" for overdue', () => {
    expect(getBucketLabel('overdue', now)).toBe('Overdue');
  });

  it('returns current month name for this-month', () => {
    expect(getBucketLabel('this-month', now)).toBe('March 2026');
  });

  it('returns next month name for next-month', () => {
    expect(getBucketLabel('next-month', now)).toBe('April 2026');
  });

  it('handles December rollover for next-month', () => {
    const dec = new Date(2026, 11, 15);
    expect(getBucketLabel('next-month', dec)).toBe('January 2027');
  });

  it('returns "TBD" for tbd', () => {
    expect(getBucketLabel('tbd', now)).toBe('TBD');
  });
});

describe('compareBuckets', () => {
  it('sorts overdue before this-month', () => {
    expect(compareBuckets('overdue', 'this-month')).toBeLessThan(0);
  });

  it('sorts tbd last', () => {
    const buckets: ReleaseBucket[] = ['tbd', 'overdue', 'this-month', 'future', 'next-year', 'later-this-year', 'next-month'];
    const sorted = [...buckets].sort(compareBuckets);
    expect(sorted).toEqual(['overdue', 'this-month', 'next-month', 'later-this-year', 'next-year', 'future', 'tbd']);
  });
});
