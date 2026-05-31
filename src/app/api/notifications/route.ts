import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { formatZodError } from '@/lib/validations';
import { dismissAll, listNotifications, markAllRead } from '@/lib/notifications/queries';

/** GET /api/notifications — most recent 20 notifications for the user. */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  try {
    const notifications = listNotifications(userId);
    return apiSuccess({ notifications });
  } catch (error) {
    console.error('[GET /api/notifications]', error);
    return apiError('Failed to load notifications');
  }
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
    return apiValidationError(formatZodError(parsed.error));
  }

  try {
    const updated = markAllRead(userId);
    return apiSuccess({ updated });
  } catch (error) {
    console.error('[POST /api/notifications]', error);
    return apiError('Failed to mark notifications read');
  }
}

/** DELETE /api/notifications — dismiss everything still visible. */
export async function DELETE(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  try {
    const dismissed = dismissAll(userId);
    return apiSuccess({ dismissed });
  } catch (error) {
    console.error('[DELETE /api/notifications]', error);
    return apiError('Failed to dismiss notifications');
  }
}
