import { describe, it, expect } from 'vitest';
import { resolveBackTarget, gameDetailHref } from './backNav';

describe('resolveBackTarget', () => {
  it('maps each known origin to its list and label', () => {
    expect(resolveBackTarget('wishlist')).toEqual({ href: '/wishlist', label: 'Back to Wishlist' });
    expect(resolveBackTarget('backlog')).toEqual({ href: '/backlog', label: 'Back to Backlog' });
    expect(resolveBackTarget('library')).toEqual({ href: '/library', label: 'Back to Library' });
    expect(resolveBackTarget('deals')).toEqual({ href: '/deals', label: 'Back to Deals' });
    expect(resolveBackTarget('releases')).toEqual({ href: '/releases', label: 'Back to Releases' });
  });

  it('falls back to the Library for a missing origin (direct load)', () => {
    expect(resolveBackTarget(undefined)).toEqual({ href: '/library', label: 'Back to Library' });
  });

  it('falls back to the Library for an unknown origin', () => {
    expect(resolveBackTarget('bogus')).toEqual({ href: '/library', label: 'Back to Library' });
    expect(resolveBackTarget('')).toEqual({ href: '/library', label: 'Back to Library' });
  });
});

describe('gameDetailHref', () => {
  it('appends the origin as a from param when given', () => {
    expect(gameDetailHref(42, 'wishlist')).toBe('/games/42?from=wishlist');
  });

  it('links without a param when no origin is given', () => {
    expect(gameDetailHref(42)).toBe('/games/42');
  });
});
