/**
 * Playtime statistics helpers.
 *
 * Used to turn a sample of per-review Steam playtimes (minutes) into a single
 * robust "expected playtime" figure. We use the median rather than the mean —
 * it shrugs off the handful of idle/AFK accounts with thousands of hours that
 * would otherwise drag the average up. This mirrors what SteamDB used to show.
 */

/**
 * Median of a list of numbers. Returns null for an empty list.
 * Does not mutate the input.
 */
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface PlaytimeStats {
  medianHours: number;
  sampleSize: number;
}

/**
 * Compute the median playtime in hours from a sample of per-review playtimes in
 * minutes. Drops non-positive entries. Returns null when no usable data remains
 * so callers can decide whether the sample is trustworthy.
 */
export function computePlaytimeStats(minutes: number[]): PlaytimeStats | null {
  const positive = minutes.filter((m) => m > 0);
  const med = median(positive);
  if (med === null) return null;
  return {
    medianHours: Math.round((med / 60) * 10) / 10, // one decimal place
    sampleSize: positive.length,
  };
}
