import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import { formatZodError } from '@/lib/validations';
import {
  getUpNextQueue,
  recordRecommendationsShown,
  recordRecommendationAccepted,
  recordRecommendationDismissed,
} from '@/lib/db/queries';

/**
 * GET /api/backlog/recommendations — the Up Next queue for the user.
 * Read-only: surfacing is recorded via POST { action: 'shown' } so a plain
 * fetch never mutates (keeps demo mode honest).
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }
  try {
    const { searchParams } = new URL(request.url);
    const rawMax = Number(searchParams.get('maxItems'));
    const maxItems = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(10, Math.floor(rawMax)) : undefined;
    const queue = getUpNextQueue(userId, { maxItems });
    return apiSuccess({ queue });
  } catch (error) {
    console.error('[GET /api/backlog/recommendations]', error);
    return apiError('Failed to build the Up Next queue');
  }
}

const bucketSchema = z.enum(['continue', 'finish-soon', 'start-fresh', 'drop']);

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('shown'),
    items: z
      .array(
        z.object({
          gameId: z.number().int().positive(),
          bucket: bucketSchema,
          reason: z.string().min(1).max(500),
          score: z.number().optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({ action: z.literal('accepted'), gameId: z.number().int().positive() }),
  z.object({ action: z.literal('dismissed'), gameId: z.number().int().positive() }),
]);

/**
 * POST /api/backlog/recommendations — record the implicit learning signal.
 * Body:
 *   { action: 'shown', items: [{ gameId, bucket, reason, score? }] }
 *   { action: 'accepted', gameId }
 *   { action: 'dismissed', gameId }
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
    const data = parsed.data;
    if (data.action === 'shown') {
      recordRecommendationsShown(userId, data.items);
      return apiSuccess({ recorded: data.items.length });
    }
    if (data.action === 'accepted') {
      return apiSuccess({ updated: recordRecommendationAccepted(userId, data.gameId) });
    }
    return apiSuccess({ updated: recordRecommendationDismissed(userId, data.gameId) });
  } catch (error) {
    console.error('[POST /api/backlog/recommendations]', error);
    return apiError('Failed to record recommendation event');
  }
}
