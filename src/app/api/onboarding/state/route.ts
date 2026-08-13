import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, apiValidationError, withAuth } from '@/lib/utils/api';
import { formatZodError } from '@/lib/validations';
import {
  getOnboardingState,
  updateOnboardingState,
  computeChecklist,
} from '@/lib/onboarding/state';

const patchSchema = z
  .object({
    wizardCompletedAt: z.string().nullable().optional(),
    steamConnectedAt: z.string().nullable().optional(),
    drainStartedAt: z.string().nullable().optional(),
    drainCompletedAt: z.string().nullable().optional(),
    drainMode: z.enum(['full', 'lite', 'cron-only']).nullable().optional(),
    drainPauseReason: z.enum(['rate-limit', 'manual']).nullable().optional(),
    drainPausedUntil: z.string().nullable().optional(),
    checklistDismissed: z.boolean().optional(),
    triagePromptDismissedAt: z.string().nullable().optional(),
  })
  .strict();

/**
 * GET /api/onboarding/state
 * Returns the user's onboarding state machine and the derived checklist.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (userId) => {
    try {
      return apiSuccess({
        state: getOnboardingState(userId),
        checklist: computeChecklist(userId),
      });
    } catch (error) {
      console.error('[GET /api/onboarding/state]', error);
      return apiError('Failed to load onboarding state');
    }
  });
}

/**
 * PATCH /api/onboarding/state
 * Merge-update the onboarding state. The wizard uses this to stamp
 * wizardCompletedAt, mark the checklist dismissed, etc.
 */
export async function PATCH(request: NextRequest) {
  return withAuth(request, async (userId) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiValidationError('Invalid JSON');
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    try {
      const next = updateOnboardingState(userId, parsed.data);
      return apiSuccess({ state: next, checklist: computeChecklist(userId) });
    } catch (error) {
      console.error('[PATCH /api/onboarding/state]', error);
      return apiError('Failed to update onboarding state');
    }
  });
}
