import { NextRequest } from 'next/server';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiUnauthorized } from '@/lib/utils/api';
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
  return apiSuccess({ count: getUnreadCount(userId) });
}
