import { z } from 'zod';
import { backfillPriceHistory } from '@/lib/sync/prices-history';
import { gameIdSchema } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import {
  apiSuccess,
  apiError,
  apiUnauthorized,
  apiValidationError,
} from '@/lib/utils/api';

const ITAD_HISTORY_EPOCH = '2012-01-01T00:00:00Z';

const bodySchema = z.object({
  since: z
    .union([z.string().datetime(), z.literal('all')])
    .optional(),
});

/**
 * POST /api/games/:id/prices/history
 * Backfill price snapshots for one game from ITAD's per-sale history endpoint.
 * Body: { since?: ISO datetime | 'all' }
 *   - omitted → ITAD default (last 3 months)
 *   - 'all'   → 2012-01-01 (ITAD's effective epoch)
 *   - ISO    → that date onward
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  let parsedId;
  try {
    const { id } = await params;
    parsedId = gameIdSchema.safeParse({ id });
  } catch {
    return apiValidationError('Invalid game ID');
  }
  if (!parsedId.success) {
    return apiValidationError('Invalid game ID');
  }

  let parsedBody: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json().catch(() => ({}));
    const result = bodySchema.safeParse(raw);
    if (!result.success) {
      return apiValidationError('Invalid body — expected { since?: ISO datetime | "all" }');
    }
    parsedBody = result.data;
  } catch {
    return apiValidationError('Invalid JSON body');
  }

  const since =
    parsedBody.since === 'all'
      ? new Date(ITAD_HISTORY_EPOCH)
      : parsedBody.since
        ? new Date(parsedBody.since)
        : undefined;

  try {
    const result = await backfillPriceHistory(parsedId.data.id, { since });
    return apiSuccess(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[POST /api/games/:id/prices/history]', message);
    // Surface user-actionable errors (missing API key, missing ITAD link) as 400s
    if (/ITAD API Key|not linked to ITAD|not found/i.test(message)) {
      return apiValidationError(message);
    }
    return apiError('Failed to backfill price history');
  }
}
