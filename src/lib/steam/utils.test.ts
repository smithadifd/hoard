import { describe, it, expect } from 'vitest';
import { isEarlyAccessFromCategories } from './utils';

describe('isEarlyAccessFromCategories', () => {
  it('returns true when category id 70 is present', () => {
    const cats = [
      { id: 2, description: 'Single-player' },
      { id: 70, description: 'Early Access' },
      { id: 22, description: 'Steam Achievements' },
    ];
    expect(isEarlyAccessFromCategories(cats)).toBe(true);
  });

  it('returns false when category id 70 is absent', () => {
    const cats = [
      { id: 2, description: 'Single-player' },
      { id: 22, description: 'Steam Achievements' },
      { id: 28, description: 'Full controller support' },
    ];
    expect(isEarlyAccessFromCategories(cats)).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(isEarlyAccessFromCategories([])).toBe(false);
  });

  it('returns false when categories is undefined', () => {
    expect(isEarlyAccessFromCategories(undefined)).toBe(false);
  });
});
