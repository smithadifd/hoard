import { getEnrichedGameById, updateUserGame } from '@/lib/db/queries';
import { gameIdSchema, gameUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError, apiNotFound } from '@/lib/utils/api';

/**
 * GET /api/games/:id
 * Get full details for a specific game.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid game ID');
    }

    const game = getEnrichedGameById(idResult.data.id, userId);
    if (!game) {
      return apiNotFound('Game');
    }

    return apiSuccess(game);
  } catch (error) {
    console.error('[GET /api/games/:id]', error);
    return apiError('Failed to fetch game');
  }
}

/**
 * PATCH /api/games/:id
 * Update user-specific game data (interest, notes, watchlist status).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid game ID');
    }

    const body = await request.json();
    const parsed = gameUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    if (Object.keys(parsed.data).length === 0) {
      return apiValidationError('No valid fields to update');
    }

    const updated = updateUserGame(idResult.data.id, parsed.data, userId);
    if (!updated) {
      return apiNotFound('Game');
    }

    return apiSuccess({ message: 'Updated' });
  } catch (error) {
    console.error('[PATCH /api/games/:id]', error);
    return apiError('Failed to update game');
  }
}
