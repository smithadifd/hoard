import { backfillPriceHistory } from '@/lib/sync/prices-history';
import { getITADClient } from '@/lib/itad/client';
import {
  getGameBackfillState,
  bulkUpdateGameItadIds,
  markPriceHistoryBackfilled,
  incrementPriceHistoryMissCount,
  PRICE_HISTORY_GIVE_UP_MISSES,
} from '@/lib/db/queries';
import { gameIdSchema } from '@/lib/validations';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import {
  apiSuccess,
  apiError,
  apiUnauthorized,
  apiValidationError,
  apiNotFound,
} from '@/lib/utils/api';

// ITAD's effective history epoch — matches the manual "All available" depth and the cron backfill.
const FULL_HISTORY_SINCE = new Date('2012-01-01T00:00:00Z');

// Per-game in-flight guard: stops a double page-mount / rapid re-open from firing two
// concurrent ITAD lookups + backfills for the same game before backfilledAt is stamped.
const inFlight = new Set<number>();

/**
 * POST /api/games/:id/prices/ensure-history
 *
 * Idempotent, once-per-game backfill driver for the game detail page. Unlike the
 * manual `.../prices/history` route, this resolves a missing ITAD link, guards on
 * `priceHistoryBackfilledAt` + miss-count so it only ever does real work once, and
 * stamps the backfill marker on success. Safe to fire on every page open — a game
 * that's already backfilled (or has exhausted its retries) returns a cheap no-op.
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

  let gameId: number;
  try {
    const { id } = await params;
    const parsed = gameIdSchema.safeParse({ id });
    if (!parsed.success) return apiValidationError('Invalid game ID');
    gameId = parsed.data.id;
  } catch {
    return apiValidationError('Invalid game ID');
  }

  const game = getGameBackfillState(gameId);
  if (!game) return apiNotFound('Game');

  // Already done, or given up after too many misses — no-op.
  // Loose `!= null` so an unset column (null or undefined) falls through to a backfill.
  if (game.priceHistoryBackfilledAt != null) {
    return apiSuccess({ status: 'already-backfilled' });
  }
  if (game.priceHistoryMissCount >= PRICE_HISTORY_GIVE_UP_MISSES) {
    return apiSuccess({ status: 'gave-up' });
  }

  if (inFlight.has(gameId)) {
    return apiSuccess({ status: 'in-progress' });
  }
  inFlight.add(gameId);

  try {
    // Resolve the ITAD link on demand if missing (lookup games never have one).
    let itadGameId = game.itadGameId;
    if (!itadGameId) {
      const lookup = await getITADClient().lookupBySteamAppId(game.steamAppId);
      if (lookup?.found && lookup.game?.id) {
        itadGameId = lookup.game.id;
        bulkUpdateGameItadIds([{ steamAppId: game.steamAppId, itadGameId }]);
      } else {
        // No ITAD match — count the miss and let it retry on a later open (ITAD may
        // link the game in future). Do NOT stamp backfilledAt: that's success-only.
        incrementPriceHistoryMissCount(gameId);
        return apiSuccess({ status: 'no-itad-link' });
      }
    }

    const result = await backfillPriceHistory(gameId, { since: FULL_HISTORY_SINCE });
    markPriceHistoryBackfilled(gameId);
    return apiSuccess({ status: 'backfilled', inserted: result.inserted, events: result.events });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[POST /api/games/:id/prices/ensure-history]', message);
    incrementPriceHistoryMissCount(gameId);
    return apiError('Failed to backfill price history');
  } finally {
    inFlight.delete(gameId);
  }
}
