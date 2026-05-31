import { NextRequest } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized } from '@/lib/utils/api';
import { getUnreadCount } from '@/lib/notifications/queries';

/**
 * GET /api/notifications/unread-count
 * Cheap polling target for the bell badge.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  try {
    return apiSuccess({ count: getUnreadCount(userId) });
  } catch (error) {
    console.error('[GET /api/notifications/unread-count]', error);
    return apiError('Failed to load unread count');
  }
}
