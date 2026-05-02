import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games } from '@/lib/db/schema';
import { getITADClient } from '@/lib/itad/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiUnauthorized, apiNotFound, apiValidationError } from '@/lib/utils/api';
import { gameIdSchema } from '@/lib/validations';
import type { ITADOverviewPrice } from '@/lib/itad/types';

/** In-memory 1h TTL cache keyed by steamAppId. Bounded to keep long-lived
 * server processes from accumulating stale entries indefinitely. */
const cache = new Map<number, { data: ITADOverviewPrice; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 500;

/** Drop expired entries; if still over the cap, drop the oldest by insertion order. */
function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * GET /api/games/:id/itad-overview
 * Returns live ITAD pricing overview for a game.
 * Uses a module-level 1h TTL cache to avoid hammering ITAD on repeated page loads.
 */
export async function GET(
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

  try {
    const db = getDb();
    const game = db
      .select({ id: games.id, steamAppId: games.steamAppId })
      .from(games)
      .where(eq(games.id, idResult.data.id))
      .get();

    if (!game) {
      return apiNotFound('Game');
    }

    const { steamAppId } = game;
    const now = Date.now();

    // Cache hit
    const cached = cache.get(steamAppId);
    if (cached && cached.expiresAt > now) {
      return apiSuccess(cached.data);
    }

    // Cache miss — fetch from ITAD
    const resultMap = await getITADClient().getPricesBySteamAppIds([steamAppId]);
    const overview = resultMap.get(steamAppId) ?? null;

    if (overview) {
      pruneCache(now);
      cache.set(steamAppId, { data: overview, expiresAt: now + CACHE_TTL_MS });
    }

    return apiSuccess(overview);
  } catch (error) {
    console.error('[GET /api/games/:id/itad-overview]', error);
    // Return null gracefully rather than 500 — ITAD failures shouldn't break the page
    return apiSuccess(null);
  }
}
