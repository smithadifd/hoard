import { describe, it, expect } from 'vitest';
import { isWithinQuietHours, DEFAULT_PREFERENCES } from './preferences';

describe('isWithinQuietHours', () => {
  const enabled = (start: number, end: number) => ({ enabled: true, start, end });

  it('returns false when disabled regardless of hour', () => {
    expect(isWithinQuietHours({ enabled: false, start: 22, end: 8 }, 23)).toBe(false);
    expect(isWithinQuietHours({ enabled: false, start: 22, end: 8 }, 3)).toBe(false);
  });

  it('handles a same-day window (8 → 22): inclusive start, exclusive end', () => {
    const q = enabled(8, 22);
    expect(isWithinQuietHours(q, 7)).toBe(false);
    expect(isWithinQuietHours(q, 8)).toBe(true);
    expect(isWithinQuietHours(q, 12)).toBe(true);
    expect(isWithinQuietHours(q, 21)).toBe(true);
    expect(isWithinQuietHours(q, 22)).toBe(false);
  });

  it('handles a wrap-around window (22 → 8) spanning midnight', () => {
    const q = enabled(22, 8);
    expect(isWithinQuietHours(q, 22)).toBe(true);
    expect(isWithinQuietHours(q, 23)).toBe(true);
    expect(isWithinQuietHours(q, 0)).toBe(true);
    expect(isWithinQuietHours(q, 7)).toBe(true);
    expect(isWithinQuietHours(q, 8)).toBe(false);
    expect(isWithinQuietHours(q, 12)).toBe(false);
  });

  it('treats start === end as an empty window (never quiet)', () => {
    expect(isWithinQuietHours(enabled(10, 10), 10)).toBe(false);
    expect(isWithinQuietHours(enabled(10, 10), 0)).toBe(false);
  });
});

describe('DEFAULT_PREFERENCES', () => {
  it('enables both channels by default, except price-paid suggestions (in-app only)', () => {
    for (const [category, routing] of Object.entries(DEFAULT_PREFERENCES.categories)) {
      if (category === 'price-paid-suggestion') {
        // Transactional nudge — a Discord ping would be noise.
        expect(routing).toEqual({ inApp: true, discord: false });
      } else {
        expect(routing).toEqual({ inApp: true, discord: true });
      }
    }
  });

  it('defaults throttle to 24h, digest to noon, and quiet hours off', () => {
    expect(DEFAULT_PREFERENCES.frequency.throttleHours).toBe(24);
    expect(DEFAULT_PREFERENCES.frequency.digestHour).toBe(12);
    expect(DEFAULT_PREFERENCES.quietHours.enabled).toBe(false);
  });
});
