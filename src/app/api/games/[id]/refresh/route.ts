import { refreshGameFromSources } from '@/lib/sync/refresh-game';
import { apiSuccess, apiError, apiNotFound, apiValidationError, withAuth } from '@/lib/utils/api';
import { gameIdSchema } from '@/lib/validations';

// One refresh per game at a time: a double-click shouldn't fire two rounds of
// Steam and HLTB requests.
const inFlight = new Set<number>();

/**
 * POST /api/games/:id/refresh
 * Manual "Refresh from Steam": re-pulls reviews and store details, re-samples
 * the reviewer playtime median and retries HLTB, ignoring schedules and
 * give-up caps. Returns what happened per source.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(request, async () => {
    const { id } = await params;
    const idResult = gameIdSchema.safeParse({ id });
    if (!idResult.success) {
      return apiValidationError('Invalid game ID');
    }
    const gameId = idResult.data.id;

    if (inFlight.has(gameId)) {
      return apiError('A refresh for this game is already running', 409);
    }
    inFlight.add(gameId);
    try {
      const result = await refreshGameFromSources(gameId);
      if (!result) return apiNotFound('Game');
      return apiSuccess(result);
    } catch (error) {
      console.error('[POST /api/games/:id/refresh]', error);
      return apiError('Failed to refresh game');
    } finally {
      inFlight.delete(gameId);
    }
  });
}
