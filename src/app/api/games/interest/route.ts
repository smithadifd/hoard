import { NextRequest } from 'next/server';
import { updateUserGame } from '@/lib/db/queries';
import { interestSchema, formatZodError } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiValidationError, apiNotFound } from '@/lib/utils/api';

/**
 * POST /api/games/interest
 * Update a game's personal interest rating.
 * Body: { gameId: number, interest: number (1-5) }
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  try {
    const body = await request.json();
    const parsed = interestSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(formatZodError(parsed.error));
    }

    const { gameId, interest } = parsed.data;
    const updated = updateUserGame(gameId, { personalInterest: interest }, userId);

    if (!updated) {
      return apiNotFound('Game');
    }

    return apiSuccess({ gameId, interest });
  } catch (error) {
    console.error('[POST /api/games/interest]', error);
    return apiError('Failed to update interest');
  }
}
