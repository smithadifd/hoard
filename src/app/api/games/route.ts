import { NextRequest } from 'next/server';
import { getEnrichedGames } from '@/lib/db/queries';
import { gameFiltersSchema, searchParamsToObject, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError } from '@/lib/utils/api';

/**
 * GET /api/games
 * Query games with filters and pagination.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const raw = searchParamsToObject(request.nextUrl.searchParams);
    const parsed = gameFiltersSchema.safeParse(raw);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const { page, pageSize, ...filters } = parsed.data;
    const result = getEnrichedGames(filters, page, pageSize, userId);

    return apiSuccess(result.games, { total: result.total, page, pageSize });
  } catch (error) {
    console.error('[GET /api/games]', error);
    return apiError('Failed to fetch games');
  }
}
