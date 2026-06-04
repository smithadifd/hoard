import { describe, it, expect } from 'vitest';
import { isEarlyAccessFromGenres } from './utils';

describe('isEarlyAccessFromGenres', () => {
  it('returns true when genre id "70" (Early Access) is present', () => {
    const genres = [
      { id: '1', description: 'Action' },
      { id: '70', description: 'Early Access' },
      { id: '23', description: 'Indie' },
    ];
    expect(isEarlyAccessFromGenres(genres)).toBe(true);
  });

  it('returns false when genre id "70" is absent', () => {
    const genres = [
      { id: '1', description: 'Action' },
      { id: '25', description: 'Adventure' },
      { id: '23', description: 'Indie' },
    ];
    expect(isEarlyAccessFromGenres(genres)).toBe(false);
  });

  // Regression guard: the bug read the *categories* array, where id 70 means
  // "Surround Sound". Genre ids are strings ("70"); a numeric category-style 70
  // must never count as Early Access.
  it('does not treat a numeric category-style id 70 as Early Access', () => {
    const genres = [{ id: 70 as unknown as string, description: 'Surround Sound' }];
    expect(isEarlyAccessFromGenres(genres)).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(isEarlyAccessFromGenres([])).toBe(false);
  });

  it('returns false when genres is undefined', () => {
    expect(isEarlyAccessFromGenres(undefined)).toBe(false);
  });
});
