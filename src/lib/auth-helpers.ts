import { auth } from './auth';
import { headers } from 'next/headers';

/**
 * Get the authenticated user's session in Server Components.
 * Returns the session or null if not authenticated.
 */
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Get the authenticated user's ID in Server Components.
 * Throws if not authenticated.
 */
export async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Authentication required');
  }
  return session.user.id;
}

/**
 * Get the authenticated user's ID from a Request object.
 * Use in API route handlers.
 */
export async function requireUserIdFromRequest(request: Request): Promise<string> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) {
    throw new Error('Authentication required');
  }
  return session.user.id;
}
