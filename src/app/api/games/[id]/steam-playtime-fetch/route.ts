import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games } from '@/lib/db/schema';
import { getSteamClient } from '@/lib/steam/client';
import { updateGameSteamPlaytime } from '@/lib/db/queries';
import { isSteamPlaytimeDue } from '@/lib/freshness';
import { STEAM_PLAYTIME_MIN_SAMPLE } from '@/lib/playtimeSource';
import { computePlaytimeStats } from '@/lib/utils/playtime';
import { apiSuccess, apiError, apiNotFound, apiValidationError, withAuth } from '@/lib/utils/api';
import { gameIdSchema } from '@/lib/validations';

/**
 * POST /api/games/:id/steam-playtime-fetch
 * On-demand Steam-review playtime sample for a single game. Samples only when
 * {@link isSteamPlaytimeDue} says so (the same schedule as the nightly sync);
 * otherwise returns what's stored. `refreshed` tells the page whether a new
 * median landed and a re-render is worth it.
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

    try {
      const db = getDb();
      const game = db
        .select({
          id: games.id,
          steamAppId: games.steamAppId,
          steamPlaytimeMedian: games.steamPlaytimeMedian,
          steamPlaytimeSampleSize: games.steamPlaytimeSampleSize,
          steamPlaytimeMissCount: games.steamPlaytimeMissCount,
          steamPlaytimeUpdatedAt: games.steamPlaytimeUpdatedAt,
          isReleased: games.isReleased,
          releaseDate: games.releaseDate,
        })
        .from(games)
        .where(eq(games.id, gameId))
        .get();

      if (!game) {
        return apiNotFound('Game');
      }

      const stored = {
        steamPlaytimeMedian: game.steamPlaytimeMedian ?? null,
        steamPlaytimeSampleSize: game.steamPlaytimeSampleSize ?? null,
        refreshed: false,
      };

      // Not due (fresh median, unreleased, or inside a retry backoff): no Steam call.
      if (!isSteamPlaytimeDue(game, new Date())) {
        return apiSuccess(stored);
      }

      // Sample the reviews and compute the median.
      const playtimes = await getSteamClient().getReviewPlaytimes(game.steamAppId);
      const stats = playtimes === null ? null : computePlaytimeStats(playtimes);

      if (stats && stats.sampleSize >= STEAM_PLAYTIME_MIN_SAMPLE) {
        updateGameSteamPlaytime(game.id, stats);
        return apiSuccess({
          steamPlaytimeMedian: stats.medianHours,
          steamPlaytimeSampleSize: stats.sampleSize,
          refreshed: true,
        });
      }

      // No usable sample: record a miss (pushes the next attempt out) and keep
      // any median already stored.
      updateGameSteamPlaytime(game.id, null);
      return apiSuccess(stored);
    } catch (error) {
      console.error('[POST /api/games/:id/steam-playtime-fetch]', error);
      return apiError('Failed to fetch Steam playtime');
    }
  });
}
