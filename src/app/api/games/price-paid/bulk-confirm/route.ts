import { NextRequest } from 'next/server';
import { bulkConfirmPricePaidSuggestions } from '@/lib/db/queries';
import { bulkConfirmPricePaidSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * POST /api/games/price-paid/bulk-confirm
 *
 * Bulk-apply price-paid suggestions — the backlog counterpart to the per-game
 * "Did you pay ~$X?" confirm/adjust prompt (PATCH /api/games/:id). Covered by the
 * existing `{ method: 'POST', prefix: '/api/games' }` DEMO_BLOCKED rule in
 * proxy.ts, so no separate demo-mode entry is needed for this route.
 *
 * Body: { entries: { gameId: number, value?: number }[] }
 *   - omit `value` to accept the stored pricePaidSuggested as-is
 *   - set `value` to write a user-adjusted amount instead
 *
 * Returns { applied: number[], skipped: number[] }. An entry is skipped (never
 * overwritten) when the game is no longer pending at write time — already
 * confirmed (by this same batch, an earlier confirm, or a manually-entered
 * price), or its suggestion was dismissed. See bulkConfirmPricePaidSuggestions.
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json().catch(() => null);
    if (body === null) {
      return apiValidationError('Invalid JSON');
    }
    const parsed = bulkConfirmPricePaidSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const result = bulkConfirmPricePaidSuggestions(parsed.data.entries, userId);
    return apiSuccess(result);
  } catch (error) {
    console.error('[POST /api/games/price-paid/bulk-confirm]', error);
    return apiError('Failed to confirm price-paid suggestions');
  }
}
