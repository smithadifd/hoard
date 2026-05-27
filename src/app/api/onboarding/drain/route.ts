import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import {
  startDrain,
  cancelDrain,
  getDrainProgressForUser,
} from '@/lib/sync/drain';

const startSchema = z.object({
  mode: z.enum(['full', 'lite', 'cron-only']),
});

/**
 * POST /api/onboarding/drain
 * Start the drain orchestrator. Returns 409 if a drain is already in flight,
 * 403 in demo mode.
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

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError('mode must be one of: full, lite, cron-only');
  }

  const result = startDrain({ mode: parsed.data.mode, userId });
  if (!result.started) {
    if (result.reason === 'already-running') {
      return apiError('A drain is already in progress', 409);
    }
    if (result.reason === 'demo-mode') {
      return apiError('Drain is disabled in demo mode', 403);
    }
    return apiError('Failed to start drain');
  }

  return apiSuccess(getDrainProgressForUser(userId));
}

/**
 * GET /api/onboarding/drain
 * Poll-friendly snapshot of the drain's progress for the calling user.
 * `getDrainProgressForUser` only returns the in-memory orchestrator state
 * when the caller actually owns the in-flight drain — otherwise it falls
 * back to the on-disk onboarding state. This prevents User B from seeing
 * User A's live drain progress in a multi-user install.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  return apiSuccess(getDrainProgressForUser(userId));
}

/**
 * DELETE /api/onboarding/drain
 * Cancel the in-flight drain. Returns 200 with a flag indicating whether a
 * drain was actually running. Either way the orchestrator ends up idle.
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  const cancelled = cancelDrain();
  return apiSuccess({ cancelled });
}
