import { describe, it, expect } from 'vitest';
import {
  daysSinceRelease,
  isYoungGame,
  isSteamPlaytimeDue,
  isHltbYoungRetryDue,
  prioritizeMetadataRefresh,
} from './freshness';

const NOW = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('daysSinceRelease', () => {
  it('handles both Steam date orders', () => {
    expect(Math.floor(daysSinceRelease('Oct 9, 2026', NOW)!)).toBe(23);
    expect(Math.floor(daysSinceRelease('13 Oct, 2026', NOW)!)).toBe(19);
  });

  it('is null for vague or missing dates', () => {
    expect(daysSinceRelease('Q4 2026', NOW)).toBeNull();
    expect(daysSinceRelease('2026', NOW)).toBeNull();
    expect(daysSinceRelease('Coming soon', NOW)).toBeNull();
    expect(daysSinceRelease(null, NOW)).toBeNull();
  });
});

describe('isYoungGame', () => {
  it('is true inside the 90-day window after launch', () => {
    expect(isYoungGame({ isReleased: true, releaseDate: 'Oct 9, 2026' }, NOW)).toBe(true);
  });

  it('is false for older games, future dates and known-unreleased games', () => {
    expect(isYoungGame({ isReleased: true, releaseDate: 'Jun 25, 2024' }, NOW)).toBe(false);
    expect(isYoungGame({ isReleased: null, releaseDate: 'Dec 14, 2026' }, NOW)).toBe(false);
    expect(isYoungGame({ isReleased: false, releaseDate: 'Oct 9, 2026' }, NOW)).toBe(false);
  });
});

describe('isSteamPlaytimeDue', () => {
  const base = {
    isReleased: true,
    releaseDate: 'Jun 25, 2024',
    steamPlaytimeMedian: null,
    steamPlaytimeUpdatedAt: null,
    steamPlaytimeMissCount: 0,
  };

  it('is due when never sampled', () => {
    expect(isSteamPlaytimeDue(base, NOW)).toBe(true);
  });

  it('never samples a game Steam says is unreleased', () => {
    expect(isSteamPlaytimeDue({ ...base, isReleased: false }, NOW)).toBe(false);
  });

  it('spaces retries after a miss under the cap', () => {
    expect(isSteamPlaytimeDue({ ...base, steamPlaytimeMissCount: 1, steamPlaytimeUpdatedAt: daysAgo(1) }, NOW)).toBe(false);
    expect(isSteamPlaytimeDue({ ...base, steamPlaytimeMissCount: 1, steamPlaytimeUpdatedAt: daysAgo(2) }, NOW)).toBe(true);
  });

  it('keeps retrying monthly after the give-up cap instead of stopping for good', () => {
    // Car Park Capital: three pre-launch misses in July, launched Oct 9.
    const gaveUp = { ...base, releaseDate: 'Oct 9, 2026', steamPlaytimeMissCount: 3 };
    expect(isSteamPlaytimeDue({ ...gaveUp, steamPlaytimeUpdatedAt: '2026-07-04T02:31:03.229Z' }, NOW)).toBe(true);
    expect(isSteamPlaytimeDue({ ...gaveUp, steamPlaytimeUpdatedAt: daysAgo(10) }, NOW)).toBe(false);
  });

  it('re-samples a young game weekly and an established one quarterly', () => {
    const young = { ...base, releaseDate: 'Oct 9, 2026', steamPlaytimeMedian: 4.2 };
    expect(isSteamPlaytimeDue({ ...young, steamPlaytimeUpdatedAt: daysAgo(6) }, NOW)).toBe(false);
    expect(isSteamPlaytimeDue({ ...young, steamPlaytimeUpdatedAt: daysAgo(7) }, NOW)).toBe(true);

    const old = { ...base, steamPlaytimeMedian: 12 };
    expect(isSteamPlaytimeDue({ ...old, steamPlaytimeUpdatedAt: daysAgo(30) }, NOW)).toBe(false);
    expect(isSteamPlaytimeDue({ ...old, steamPlaytimeUpdatedAt: daysAgo(90) }, NOW)).toBe(true);
  });
});

describe('isHltbYoungRetryDue', () => {
  const young = { isReleased: true, releaseDate: 'Oct 9, 2026', hltbId: null, hltbLastUpdated: daysAgo(8) };

  it('retries a young unmatched game weekly', () => {
    expect(isHltbYoungRetryDue(young, NOW)).toBe(true);
    expect(isHltbYoungRetryDue({ ...young, hltbLastUpdated: daysAgo(3) }, NOW)).toBe(false);
  });

  it('leaves matched and established games to the normal backoff', () => {
    expect(isHltbYoungRetryDue({ ...young, hltbId: 123 }, NOW)).toBe(false);
    expect(isHltbYoungRetryDue({ ...young, releaseDate: 'Jun 25, 2024' }, NOW)).toBe(false);
  });
});

describe('prioritizeMetadataRefresh', () => {
  it('puts stale young games ahead of the LRU order, then truncates', () => {
    const rows = [
      { id: 1, isReleased: true, releaseDate: 'Jun 25, 2024', metadataLastUpdated: daysAgo(5) },
      { id: 2, isReleased: true, releaseDate: 'Jun 25, 2024', metadataLastUpdated: daysAgo(4) },
      { id: 3, isReleased: true, releaseDate: 'Oct 9, 2026', metadataLastUpdated: daysAgo(2) },
      { id: 4, isReleased: true, releaseDate: 'Oct 20, 2026', metadataLastUpdated: daysAgo(0.5) },
    ];
    expect(prioritizeMetadataRefresh(rows, NOW, 3).map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
