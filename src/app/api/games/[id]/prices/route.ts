import { getPriceHistory } from '@/lib/db/queries';
import { gameIdSchema } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * GET /api/games/:id/prices
 * Returns price history for a specific game.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid game ID');
    }

    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') ?? '90', 10);
    const limit = Math.min(Math.max(limitParam || 90, 1), 365);

    const history = getPriceHistory(idResult.data.id, limit);
    return apiSuccess(history);
  } catch (error) {
    console.error('[GET /api/games/:id/prices]', error);
    return apiError('Failed to fetch price history');
  }
}
