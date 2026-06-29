import { describe, it, expect, beforeEach } from 'vitest';
import {
  isGameDetailPath,
  trackPreviousPathname,
  getPreviousPathname,
  __resetScrollRestorationTracking,
} from './useScrollRestoration';

describe('isGameDetailPath', () => {
  it('matches a game detail route', () => {
    expect(isGameDetailPath('/games/123')).toBe(true);
    expect(isGameDetailPath('/games/abc-def')).toBe(true);
  });

  it('rejects list routes and other paths', () => {
    expect(isGameDetailPath('/library')).toBe(false);
    expect(isGameDetailPath('/wishlist')).toBe(false);
    expect(isGameDetailPath('/backlog')).toBe(false);
    expect(isGameDetailPath('/games')).toBe(false);
    expect(isGameDetailPath('/games/123/edit')).toBe(false);
    expect(isGameDetailPath('/')).toBe(false);
    expect(isGameDetailPath(null)).toBe(false);
  });
});

describe('trackPreviousPathname', () => {
  beforeEach(() => {
    __resetScrollRestorationTracking();
  });

  it('starts with no previous path (fresh entry)', () => {
    trackPreviousPathname('/wishlist');
    // First-ever route has no predecessor — list should start at the top.
    expect(getPreviousPathname()).toBeNull();
  });

  it('records the prior route when navigating to a new path', () => {
    trackPreviousPathname('/wishlist');
    trackPreviousPathname('/games/42');
    expect(getPreviousPathname()).toBe('/wishlist');
  });

  it('reports a game detail as the previous path on return navigation', () => {
    trackPreviousPathname('/wishlist'); // enter list
    trackPreviousPathname('/games/42'); // click into a game
    trackPreviousPathname('/wishlist'); // navigate back
    expect(getPreviousPathname()).toBe('/games/42');
    expect(isGameDetailPath(getPreviousPathname())).toBe(true);
  });

  it('reports an unrelated previous path when entering from elsewhere', () => {
    trackPreviousPathname('/'); // dashboard
    trackPreviousPathname('/wishlist'); // jump straight to the list
    expect(getPreviousPathname()).toBe('/');
    expect(isGameDetailPath(getPreviousPathname())).toBe(false);
  });

  it('is idempotent for repeated renders of the same path', () => {
    trackPreviousPathname('/games/42');
    trackPreviousPathname('/wishlist');
    trackPreviousPathname('/wishlist'); // re-render, same route
    expect(getPreviousPathname()).toBe('/games/42');
  });
});
