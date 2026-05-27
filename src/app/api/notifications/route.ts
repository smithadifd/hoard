import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { dismissAll, listNotifications, markAllRead } from '@/lib/notifications/queries';

/** GET /api/notifications — most recent 20 notifications for the user. */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  const notifications = listNotifications(userId);
  return apiSuccess({ notifications });
}

const actionSchema = z.object({
  action: z.literal('mark-all-read'),
});

/**
 * POST /api/notifications — bulk actions on the collection.
 * Body: `{ action: 'mark-all-read' }`.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError('Invalid JSON');
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? 'Invalid action');
  }

  const updated = markAllRead(userId);
  return apiSuccess({ updated });
}

/** DELETE /api/notifications — dismiss everything still visible. */
export async function DELETE(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  const dismissed = dismissAll(userId);
  return apiSuccess({ dismissed });
}
