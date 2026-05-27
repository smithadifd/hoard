import { getEnrichedGameById, updateUserGame, updateManualHltbData, setHltbExcluded, getRatedGameCount } from '@/lib/db/queries';
import { gameIdSchema, gameUpdateSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError, apiNotFound } from '@/lib/utils/api';
import { milestones } from '@/lib/onboarding/milestones';

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

    // Separate HLTB fields (games table) from user fields (user_games table)
    const { hltbMain, hltbMainExtra, hltbCompletionist, hltbExcluded, ...userFields } = parsed.data;
    const hasHltbFields = hltbMain !== undefined || hltbMainExtra !== undefined || hltbCompletionist !== undefined;

    if (hltbExcluded !== undefined) {
      setHltbExcluded(idResult.data.id, hltbExcluded);
    } else if (hasHltbFields) {
      updateManualHltbData(idResult.data.id, {
        hltbMain: hltbMain ?? null,
        hltbMainExtra: hltbMainExtra ?? null,
        hltbCompletionist: hltbCompletionist ?? null,
      });
    }

    if (Object.keys(userFields).length > 0) {
      const updated = updateUserGame(idResult.data.id, userFields, userId);
      if (!updated) {
        return apiNotFound('Game');
      }
    }

    // Onboarding milestone fires when the user crosses 10 rated games — only
    // relevant if this patch actually set personalInterest. Wrapped so a
    // broken milestone path never fails the user's update.
    if (userFields.personalInterest !== undefined) {
      try {
        const ratedCount = getRatedGameCount(userId);
        if (ratedCount >= 10) {
          void milestones.firstTenRated(userId, ratedCount);
        }
      } catch (err) {
        console.warn('[game PATCH] milestone hook failed:', err);
      }
    }

    return apiSuccess({ message: 'Updated' });
  } catch (error) {
    console.error('[PATCH /api/games/:id]', error);
    return apiError('Failed to update game');
  }
}
