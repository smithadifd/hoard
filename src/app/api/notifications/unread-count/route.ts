import { NextRequest } from 'next/server';
import { apiSuccess, apiError, withAuth } from '@/lib/utils/api';
import { getUnreadCount } from '@/lib/notifications/queries';

/**
 * GET /api/notifications/unread-count
 * Cheap polling target for the bell badge.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (userId) => {
    try {
      return apiSuccess({ count: getUnreadCount(userId) });
    } catch (error) {
      console.error('[GET /api/notifications/unread-count]', error);
      return apiError('Failed to load unread count');
    }
  });
}
