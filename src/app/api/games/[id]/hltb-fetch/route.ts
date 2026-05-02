import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games } from '@/lib/db/schema';
import { getHLTBClient } from '@/lib/hltb/client';
import { updateGameHltbData } from '@/lib/db/queries';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, apiValidationError } from '@/lib/utils/api';
import { gameIdSchema } from '@/lib/validations';

const SIMILARITY_THRESHOLD = 0.4;

/**
 * POST /api/games/:id/hltb-fetch
 * On-demand HLTB fetch for a single game.
 * If hltbMain is already non-null, returns existing data without refetching.
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

  const { id } = await params;
  const idResult = gameIdSchema.safeParse({ id });
  if (!idResult.success) {
    return apiValidationError('Invalid game ID');
  }

  const gameId = idResult.data.id;

  try {
    const db = getDb();
    const game = db
      .select({
        id: games.id,
        title: games.title,
        hltbMain: games.hltbMain,
        hltbMainExtra: games.hltbMainExtra,
        hltbCompletionist: games.hltbCompletionist,
        hltbMissCount: games.hltbMissCount,
      })
      .from(games)
      .where(eq(games.id, gameId))
      .get();

    if (!game) {
      return apiNotFound('Game');
    }

    // Already has HLTB data — return existing without refetch.
    if (game.hltbMain !== null && game.hltbMain !== undefined) {
      return apiSuccess({
        hltbMain: game.hltbMain,
        hltbMainExtra: game.hltbMainExtra ?? null,
        hltbCompletionist: game.hltbCompletionist ?? null,
      });
    }

    // Already attempted at least once and didn't match — don't keep retrying
    // on every page view. The bulk HLTB sync handles backoff/retry policy.
    if ((game.hltbMissCount ?? 0) > 0) {
      return apiSuccess({ hltbMain: null, hltbMainExtra: null, hltbCompletionist: null });
    }

    // Fetch from HLTB
    const result = await getHLTBClient().search(game.title);

    if (result && result.similarity >= SIMILARITY_THRESHOLD) {
      updateGameHltbData(game.id, {
        hltbId: parseInt(result.id, 10) || undefined,
        hltbMain: result.gameplayMain > 0 ? result.gameplayMain : undefined,
        hltbMainExtra: result.gameplayMainExtra > 0 ? result.gameplayMainExtra : undefined,
        hltbCompletionist: result.gameplayCompletionist > 0 ? result.gameplayCompletionist : undefined,
      }, false);

      return apiSuccess({
        hltbMain: result.gameplayMain > 0 ? result.gameplayMain : null,
        hltbMainExtra: result.gameplayMainExtra > 0 ? result.gameplayMainExtra : null,
        hltbCompletionist: result.gameplayCompletionist > 0 ? result.gameplayCompletionist : null,
      });
    }

    // No match found — mark miss
    updateGameHltbData(game.id, {}, true);
    return apiSuccess({ hltbMain: null, hltbMainExtra: null, hltbCompletionist: null });
  } catch (error) {
    console.error('[POST /api/games/:id/hltb-fetch]', error);
    return apiError('Failed to fetch HLTB data');
  }
}
