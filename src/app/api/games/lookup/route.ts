import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games } from '@/lib/db/schema';
import { getSteamClient } from '@/lib/steam/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, apiValidationError } from '@/lib/utils/api';
import { formatZodError } from '@/lib/validations';

const lookupBodySchema = z.object({
  steamAppId: z.number().int().positive(),
});

/**
 * POST /api/games/lookup
 * Look up a Steam game by appId and upsert it into the games table with source='lookup'.
 * Returns { data: { id } } — the caller can then navigate to /games/:id.
 */
export async function POST(request: Request) {
  try {
    await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError('Invalid JSON body');
  }

  const parsed = lookupBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiValidationError(formatZodError(parsed.error));
  }

  const { steamAppId } = parsed.data;

  try {
    const db = getDb();

    // Check if game already exists
    const existing = db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.steamAppId, steamAppId))
      .get();

    if (existing) {
      // Stamp lastViewedAt only on rows that originated as lookups —
      // we don't want to mutate library/wishlist-sourced rows.
      db.update(games)
        .set({ lastViewedAt: new Date() })
        .where(and(eq(games.id, existing.id), eq(games.source, 'lookup')))
        .run();
      return apiSuccess({ id: existing.id });
    }

    // Fetch app details from Steam
    const details = await getSteamClient().getAppDetails(steamAppId);
    if (!details) {
      return apiNotFound('Game not found on Steam');
    }

    const now = new Date().toISOString();

    const result = db
      .insert(games)
      .values({
        steamAppId,
        title: details.name,
        headerImageUrl: details.header_image ?? undefined,
        capsuleImageUrl: details.capsule_image ?? undefined,
        description: details.short_description ?? undefined,
        shortDescription: details.short_description ?? undefined,
        releaseDate: details.release_date?.date ?? undefined,
        developer: details.developers?.[0] ?? undefined,
        publisher: details.publishers?.[0] ?? undefined,
        isReleased: details.release_date?.coming_soon === true ? false : details.release_date ? true : undefined,
        source: 'lookup',
        lastViewedAt: new Date(),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: games.id })
      .get();

    return apiSuccess({ id: result.id });
  } catch (error) {
    console.error('[POST /api/games/lookup]', error);
    return apiError('Failed to look up game');
  }
}
