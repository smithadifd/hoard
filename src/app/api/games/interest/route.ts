import { NextRequest } from 'next/server';
import { updateUserGame, getRatedGameCount } from '@/lib/db/queries';
import { interestSchema, formatZodError } from '@/lib/validations';
import { apiSuccess, apiError, apiValidationError, apiNotFound, withAuth } from '@/lib/utils/api';
import { milestones } from '@/lib/onboarding/milestones';

/**
 * POST /api/games/interest
 * Update a game's personal interest rating.
 * Body: { gameId: number, interest: number (1-5) }
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (userId) => {
    try {
      const body = await request.json().catch(() => null);
      if (body === null) {
        return apiValidationError('Invalid JSON');
      }
      const parsed = interestSchema.safeParse(body);
      if (!parsed.success) {
        return apiValidationError(formatZodError(parsed.error));
      }

      const { gameId, interest } = parsed.data;
      const updated = updateUserGame(gameId, { personalInterest: interest }, userId);

      if (!updated) {
        return apiNotFound('Game');
      }

      // Onboarding milestone — idempotent inside `fireMilestone`. Wrapped so
      // a broken milestone path never fails the user's rating update.
      try {
        const ratedCount = getRatedGameCount(userId);
        if (ratedCount >= 10) {
          // Fire-and-forget: don't make the user wait on a Discord embed.
          void milestones.firstTenRated(userId, ratedCount);
        }
      } catch (err) {
        console.warn('[interest] milestone hook failed:', err);
      }

      return apiSuccess({ gameId, interest });
    } catch (error) {
      console.error('[POST /api/games/interest]', error);
      return apiError('Failed to update interest');
    }
  });
}
