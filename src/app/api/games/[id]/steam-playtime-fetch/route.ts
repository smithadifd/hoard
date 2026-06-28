import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games } from '@/lib/db/schema';
import { getSteamClient } from '@/lib/steam/client';
import { updateGameSteamPlaytime, STEAM_PLAYTIME_GIVE_UP_MISSES } from '@/lib/db/queries';
import { STEAM_PLAYTIME_MIN_SAMPLE } from '@/lib/playtimeSource';
import { computePlaytimeStats } from '@/lib/utils/playtime';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, apiValidationError } from '@/lib/utils/api';
import { gameIdSchema } from '@/lib/validations';

/**
 * POST /api/games/:id/steam-playtime-fetch
 * On-demand Steam-review playtime sample for a single game. If a median is
 * already stored, returns it without refetching. Mirrors the HLTB on-demand
 * fetch route, including the miss-count backoff.
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
        steamAppId: games.steamAppId,
        steamPlaytimeMedian: games.steamPlaytimeMedian,
        steamPlaytimeSampleSize: games.steamPlaytimeSampleSize,
        steamPlaytimeMissCount: games.steamPlaytimeMissCount,
      })
      .from(games)
      .where(eq(games.id, gameId))
      .get();

    if (!game) {
      return apiNotFound('Game');
    }

    // Already have a median — return existing without refetch.
    if (game.steamPlaytimeMedian !== null && game.steamPlaytimeMedian !== undefined) {
      return apiSuccess({
        steamPlaytimeMedian: game.steamPlaytimeMedian,
        steamPlaytimeSampleSize: game.steamPlaytimeSampleSize ?? null,
      });
    }

    // Gave up after repeated empty/too-small samples — don't keep retrying on
    // every page view. (Sync/backoff policy mirrors HLTB.)
    if ((game.steamPlaytimeMissCount ?? 0) >= STEAM_PLAYTIME_GIVE_UP_MISSES) {
      return apiSuccess({ steamPlaytimeMedian: null, steamPlaytimeSampleSize: null });
    }

    // Sample the reviews and compute the median.
    const playtimes = await getSteamClient().getReviewPlaytimes(game.steamAppId);
    const stats = playtimes === null ? null : computePlaytimeStats(playtimes);

    if (stats && stats.sampleSize >= STEAM_PLAYTIME_MIN_SAMPLE) {
      updateGameSteamPlaytime(game.id, stats);
      return apiSuccess({
        steamPlaytimeMedian: stats.medianHours,
        steamPlaytimeSampleSize: stats.sampleSize,
      });
    }

    // No usable sample — mark a miss.
    updateGameSteamPlaytime(game.id, null);
    return apiSuccess({ steamPlaytimeMedian: null, steamPlaytimeSampleSize: null });
  } catch (error) {
    console.error('[POST /api/games/:id/steam-playtime-fetch]', error);
    return apiError('Failed to fetch Steam playtime');
  }
}
