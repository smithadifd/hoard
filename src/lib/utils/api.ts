import 'server-only';
import { NextResponse } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json(meta ? { data, meta } : { data });
}

export function apiError(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status });
}

export function apiNotFound(resource: string = 'Resource') {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

export function apiValidationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Shared auth preamble for API route handlers.
 *
 * Resolves the request's userId via requireUserIdFromRequest and, if that
 * throws for any reason (missing header, malformed/expired token, no
 * session, etc.), returns the same apiUnauthorized() response every route
 * previously returned inline. On success, invokes `handler` with the
 * resolved userId and returns its result unchanged.
 *
 * This replaces the copy-pasted
 *   try {
 *     userId = await requireUserIdFromRequest(request);
 *   } catch {
 *     return apiUnauthorized();
 *   }
 * preamble that used to appear at the top of every authenticated route
 * handler. `handler` may ignore the userId argument if it doesn't need it
 * (some routes only need to gate on being authenticated).
 */
export async function withAuth(
  request: Request,
  handler: (userId: string) => Promise<Response> | Response
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  return handler(userId);
}
