/**
 * Release date parsing and grouping utilities.
 *
 * Steam stores release dates as free-text strings in various formats.
 * This module normalizes them for display and timeline grouping.
 */

export interface ParsedReleaseDate {
  /** Exact or estimated date (null if unparseable) */
  date: Date | null;
  /** How precise the parsed date is */
  precision: 'day' | 'month' | 'quarter' | 'year' | 'unknown';
  /** Human-readable display string */
  label: string;
}

export type ReleaseBucket =
  | 'overdue'
  | 'this-month'
  | 'next-month'
  | 'later-this-year'
  | 'next-year'
  | 'future'
  | 'tbd';

const QUARTER_REGEX = /^Q([1-4])\s+(\d{4})$/i;
const YEAR_ONLY_REGEX = /^(\d{4})$/;
const TBD_PATTERNS = [
  'coming soon',
  'to be announced',
  'tba',
  'tbd',
  'when it\'s done',
  'wishlist now',
];

/**
 * Parse a raw Steam release date string into a structured form.
 */
export function parseReleaseDate(raw: string | null | undefined): ParsedReleaseDate {
  if (!raw || raw.trim() === '') {
    return { date: null, precision: 'unknown', label: 'TBD' };
  }

  const trimmed = raw.trim();

  // Check for TBD-like strings (exact match to avoid misclassifying "Coming Soon: Dec 2026")
  if (TBD_PATTERNS.some((p) => trimmed.toLowerCase() === p)) {
    return { date: null, precision: 'unknown', label: trimmed };
  }

  // Quarter format: "Q2 2026"
  const quarterMatch = trimmed.match(QUARTER_REGEX);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    const month = (quarter - 1) * 3; // Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct
    return {
      date: new Date(year, month, 1),
      precision: 'quarter',
      label: `Q${quarter} ${year}`,
    };
  }

  // Year only: "2026"
  const yearMatch = trimmed.match(YEAR_ONLY_REGEX);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    return {
      date: new Date(year, 0, 1),
      precision: 'year',
      label: `${year}`,
    };
  }

  // Try standard date parse (handles "Mar 15, 2026", "15 Mar 2026", etc.)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    // Check if the original string has a day number (not just month+year like "March 2026")
    const hasDay = /\d{1,2}[,\s]/.test(trimmed) || /\d{4}-\d{2}-\d{2}/.test(trimmed);

    if (hasDay) {
      return { date: parsed, precision: 'day', label: trimmed };
    }

    // Month + year only (e.g., "March 2026")
    return {
      date: new Date(parsed.getFullYear(), parsed.getMonth(), 1),
      precision: 'month',
      label: trimmed,
    };
  }

  // Unparseable
  return { date: null, precision: 'unknown', label: trimmed };
}

/**
 * Assign a parsed release date to a timeline bucket relative to `now`.
 */
export function getReleaseBucket(parsed: ParsedReleaseDate, now: Date = new Date()): ReleaseBucket {
  if (parsed.precision === 'unknown' || !parsed.date) {
    return 'tbd';
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const dateYear = parsed.date.getFullYear();
  const dateMonth = parsed.date.getMonth();

  // For day/month precision, check if the date has passed
  if (parsed.precision === 'day' || parsed.precision === 'month') {
    const endOfPeriod = parsed.precision === 'day'
      ? new Date(dateYear, dateMonth, parsed.date.getDate() + 1)
      : new Date(dateYear, dateMonth + 1, 0); // Last day of month

    if (endOfPeriod < now) return 'overdue';
  }

  // For quarter precision, check if the entire quarter has passed
  if (parsed.precision === 'quarter') {
    const quarterEndMonth = dateMonth + 3;
    const endOfQuarter = new Date(dateYear, quarterEndMonth, 0);
    if (endOfQuarter < now) return 'overdue';
  }

  // For year precision, check if the year has passed
  if (parsed.precision === 'year') {
    if (dateYear < currentYear) return 'overdue';
  }

  // For day/month precision, use granular this-month/next-month buckets
  if (parsed.precision === 'day' || parsed.precision === 'month') {
    if (dateYear === currentYear && dateMonth === currentMonth) return 'this-month';

    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    if (dateYear === nextMonthYear && dateMonth === nextMonth) return 'next-month';
  }

  // Later this year (all precisions)
  if (dateYear === currentYear) return 'later-this-year';

  // Next year
  if (dateYear === currentYear + 1) return 'next-year';

  // Further future
  return 'future';
}

/** Human-readable labels for each bucket */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getBucketLabel(bucket: ReleaseBucket, now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (bucket) {
    case 'overdue': return 'Overdue';
    case 'this-month': return `${MONTH_NAMES[month]} ${year}`;
    case 'next-month': {
      const nextMonth = month === 11 ? 0 : month + 1;
      const nextYear = month === 11 ? year + 1 : year;
      return `${MONTH_NAMES[nextMonth]} ${nextYear}`;
    }
    case 'later-this-year': return `Later in ${year}`;
    case 'next-year': return `${year + 1}`;
    case 'future': return 'Future';
    case 'tbd': return 'TBD';
  }
}

/** Sort order for buckets (lower = earlier in timeline) */
const BUCKET_ORDER: Record<ReleaseBucket, number> = {
  'overdue': 0,
  'this-month': 1,
  'next-month': 2,
  'later-this-year': 3,
  'next-year': 4,
  'future': 5,
  'tbd': 6,
};

export function compareBuckets(a: ReleaseBucket, b: ReleaseBucket): number {
  return BUCKET_ORDER[a] - BUCKET_ORDER[b];
}
