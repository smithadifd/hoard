import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withAuth } from './api';

// Mock auth helper — same pattern every route.test.ts already uses.
vi.mock('@/lib/auth-helpers', () => ({
  requireUserIdFromRequest: vi.fn(),
}));

import { requireUserIdFromRequest } from '@/lib/auth-helpers';
const mockRequireAuth = vi.mocked(requireUserIdFromRequest);

function makeRequest(): Request {
  return new Request('http://localhost/api/test');
}

describe('withAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth failure', () => {
    it('returns 401 with the standard body when requireUserIdFromRequest rejects with an Error', async () => {
      mockRequireAuth.mockRejectedValue(new Error('no session'));
      const handler = vi.fn();

      const res = await withAuth(makeRequest(), handler);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body).toEqual({ error: 'Authentication required' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when requireUserIdFromRequest rejects with a non-Error value', async () => {
      // The original inline preamble used a bare `catch {}`, which catches
      // anything — not just Error instances. withAuth must keep that.
      mockRequireAuth.mockRejectedValue('boom');
      const handler = vi.fn();

      const res = await withAuth(makeRequest(), handler);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Authentication required' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when requireUserIdFromRequest throws synchronously (before returning a promise)', async () => {
      mockRequireAuth.mockImplementation(() => {
        throw new Error('sync boom');
      });
      const handler = vi.fn();

      const res = await withAuth(makeRequest(), handler);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Authentication required' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when requireUserIdFromRequest throws a synchronous non-Error value', async () => {
      mockRequireAuth.mockImplementation(() => {
        throw 'sync non-error boom';
      });
      const handler = vi.fn();

      const res = await withAuth(makeRequest(), handler);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Authentication required' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('auth success', () => {
    it('forwards the resolved userId to the handler verbatim', async () => {
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

      await withAuth(makeRequest(), handler);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('user-abc-123');
    });

    it('calls requireUserIdFromRequest exactly once, with the request', async () => {
      const request = makeRequest();
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handler = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

      await withAuth(request, handler);

      expect(mockRequireAuth).toHaveBeenCalledTimes(1);
      expect(mockRequireAuth).toHaveBeenCalledWith(request);
    });

    it("returns the handler's response unchanged", async () => {
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handlerResponse = new Response(JSON.stringify({ data: 'ok' }), {
        status: 201,
        headers: { 'X-Test': 'yes' },
      });
      const handler = vi.fn().mockResolvedValue(handlerResponse);

      const res = await withAuth(makeRequest(), handler);

      expect(res).toBe(handlerResponse);
    });
  });

  // This is the property the whole refactor rests on: `handler(userId)` must
  // be called OUTSIDE the try/catch that guards requireUserIdFromRequest.
  // The classic wrapper bug moves the handler call inside that try, so any
  // handler error (a downstream 500) silently becomes a 401 instead of
  // propagating to the route's own try/catch. These tests fail loudly if
  // that ever happens.
  describe('handler errors propagate instead of becoming a 401', () => {
    it('propagates a synchronous throw from the handler', async () => {
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handler = vi.fn(() => {
        throw new Error('handler blew up');
      });

      await expect(withAuth(makeRequest(), handler)).rejects.toThrow('handler blew up');
    });

    it('propagates a rejected promise from the handler', async () => {
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handler = vi.fn().mockRejectedValue(new Error('async handler blew up'));

      await expect(withAuth(makeRequest(), handler)).rejects.toThrow('async handler blew up');
    });

    it('propagates a non-Error value thrown by the handler', async () => {
      mockRequireAuth.mockResolvedValue('user-abc-123');
      const handler = vi.fn(() => {
        throw 'not an Error instance';
      });

      await expect(withAuth(makeRequest(), handler)).rejects.toBe('not an Error instance');
    });
  });
});
