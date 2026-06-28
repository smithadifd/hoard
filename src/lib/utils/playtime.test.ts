import { describe, it, expect } from 'vitest';
import { median, computePlaytimeStats } from './playtime';

describe('median', () => {
  it('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });

  it('returns the middle value for an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('is robust to a single huge outlier (the AFK-account case)', () => {
    // Mean would be ~2010; median stays grounded.
    expect(median([10, 12, 15, 18, 20000])).toBe(15);
  });
});

describe('computePlaytimeStats', () => {
  it('returns null when there is no usable data', () => {
    expect(computePlaytimeStats([])).toBeNull();
    expect(computePlaytimeStats([0, 0, 0])).toBeNull();
  });

  it('drops non-positive entries before computing', () => {
    // positives: [60, 120, 180] minutes -> median 120 min -> 2.0 h, n=3
    const stats = computePlaytimeStats([0, 60, 120, 180, 0]);
    expect(stats).toEqual({ medianHours: 2, sampleSize: 3 });
  });

  it('converts minutes to hours rounded to one decimal', () => {
    // median 90 min -> 1.5 h
    expect(computePlaytimeStats([90])).toEqual({ medianHours: 1.5, sampleSize: 1 });
    // median 100 min -> 1.666.. -> 1.7 h
    expect(computePlaytimeStats([100])).toEqual({ medianHours: 1.7, sampleSize: 1 });
  });
});
