import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIError } from 'better-auth/api';

// Fake the DB so assertSignUpAllowed's user-count query is controllable.
const getMock = vi.fn();
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ get: getMock }) }),
  }),
}));

import { assertSignUpAllowed } from './auth';

describe('signup lockdown (assertSignUpAllowed)', () => {
  beforeEach(() => getMock.mockReset());

  it('allows the first account when no users exist yet', () => {
    getMock.mockReturnValue({ count: 0 });
    expect(() => assertSignUpAllowed()).not.toThrow();
  });

  it('blocks signup once an account exists (single-user lockdown)', () => {
    getMock.mockReturnValue({ count: 1 });
    expect(() => assertSignUpAllowed()).toThrow(APIError);
  });

  it('throws a FORBIDDEN APIError (not a bare Error) when locked', () => {
    getMock.mockReturnValue({ count: 3 });
    try {
      assertSignUpAllowed();
      throw new Error('expected assertSignUpAllowed to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe('FORBIDDEN');
    }
  });

  it('tolerates a missing count row (treats it as first-run, like /api/setup)', () => {
    getMock.mockReturnValue(undefined);
    expect(() => assertSignUpAllowed()).not.toThrow();
  });
});
