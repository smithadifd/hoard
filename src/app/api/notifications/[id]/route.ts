import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import {
  apiSuccess,
  apiUnauthorized,
  apiValidationError,
} from '@/lib/utils/api';
import { dismissNotification, markRead } from '@/lib/notifications/queries';

// Only `true` is meaningful — there's no undo path, and the endpoint is meant
// to flip state forward. Accepting `false` would silently no-op.
const patchSchema = z.object({
  read: z.literal(true).optional(),
  dismissed: z.literal(true).optional(),
});

/**
 * PATCH /api/notifications/[id] — flip read or dismissed state.
 * Body: `{ read?: true, dismissed?: true }` — at least one required.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  const { id: rawId } = await params;
  // parseInt rejects `1e5`-style inputs that `Number(...)` would happily parse
  // as 100000; path segments here should be plain integers.
  const id = /^\d+$/.test(rawId) ? Number.parseInt(rawId, 10) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return apiValidationError('Invalid notification id');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError('Invalid JSON');
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  let touched = false;
  if (parsed.data.read === true) {
    touched = markRead(id, userId) || touched;
  }
  if (parsed.data.dismissed === true) {
    touched = dismissNotification(id, userId) || touched;
  }

  if (!touched && parsed.data.read === undefined && parsed.data.dismissed === undefined) {
    return apiValidationError('Provide read or dismissed in the body');
  }

  if (!touched) {
    // The notification either doesn't exist for this user or was already in the
    // requested state. Both are safe to treat as a no-op success.
    return apiSuccess({ touched: false });
  }

  return apiSuccess({ touched: true });
}
