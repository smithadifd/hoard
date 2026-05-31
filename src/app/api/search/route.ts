import { z } from 'zod';
import { like, eq, and, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/index';
import { games, userGames } from '@/lib/db/schema';
import { getSteamClient } from '@/lib/steam/client';
import { requireUserIdFromRequest } from '@/lib/auth-helpers';
import { apiSuccess, apiUnauthorized, apiValidationError } from '@/lib/utils/api';
import type { SteamSearchResult } from '@/lib/steam/types';
import { searchParamsToObject, formatZodError } from '@/lib/validations';

const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export interface LibraryHit {
  id: number;
  steamAppId: number;
  title: string;
  headerImage: string | null;
  isOwned: boolean;
  isWishlisted: boolean;
  isWatchlisted: boolean;
}

export type SteamHit = SteamSearchResult;

/**
 * GET /api/search?q=…&limit=10
 * Search the user's library and Steam store in parallel.
 * Returns deduplicated results: Steam results that are already in library are excluded.
 */
export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireUserIdFromRequest(request);
  } catch {
    return apiUnauthorized();
  }

  const url = new URL(request.url);
  const parsed = searchQuerySchema.safeParse(searchParamsToObject(url.searchParams));
  if (!parsed.success) {
    return apiValidationError(formatZodError(parsed.error));
  }

  const { q, limit } = parsed.data;

  try {
    const db = getDb();

    // Sort key: 0 = exact, 1 = prefix, 2 = contains. Repeated in ORDER BY because
    // SQLite doesn't reliably resolve SELECT-list aliases inside ORDER BY for computed
    // expressions in this form.
    const sortPriorityExpr = sql<number>`CASE WHEN lower(${games.title}) = lower(${q}) THEN 0 WHEN lower(${games.title}) LIKE lower(${q + '%'}) THEN 1 ELSE 2 END`;

    // Run library query and Steam search in parallel — allSettled so a Steam
    // failure doesn't take down library results (and vice versa). The library
    // query is wrapped in an async IIFE so synchronous throws from better-sqlite3
    // become promise rejections instead of propagating before allSettled starts.
    const libraryPromise = (async () =>
      db
        .select({
          id: games.id,
          steamAppId: games.steamAppId,
          title: games.title,
          headerImage: games.headerImageUrl,
          isOwned: userGames.isOwned,
          isWishlisted: userGames.isWishlisted,
          isWatchlisted: userGames.isWatchlisted,
        })
        .from(games)
        .innerJoin(
          userGames,
          and(
            eq(games.id, userGames.gameId),
            eq(userGames.userId, userId)
          )
        )
        .where(
          and(
            like(games.title, `%${q}%`),
            or(
              eq(userGames.isOwned, true),
              eq(userGames.isWishlisted, true),
              eq(userGames.isWatchlisted, true)
            )
          )
        )
        .orderBy(sortPriorityExpr, sql`lower(${games.title}) ASC`)
        .limit(limit)
        .all())();

    const [librarySettled, steamSettled] = await Promise.allSettled([
      libraryPromise,
      getSteamClient().searchStore(q, limit),
    ]);

    if (librarySettled.status === 'rejected') {
      console.error('[GET /api/search] library query failed', librarySettled.reason);
    }
    if (steamSettled.status === 'rejected') {
      console.error('[GET /api/search] steam search failed', steamSettled.reason);
    }

    const libraryRows = librarySettled.status === 'fulfilled' ? librarySettled.value : [];
    const steamResults = steamSettled.status === 'fulfilled' ? steamSettled.value : [];

    // Build library hits
    const library: LibraryHit[] = libraryRows.map((row) => ({
      id: row.id,
      steamAppId: row.steamAppId,
      title: row.title,
      headerImage: row.headerImage ?? null,
      isOwned: row.isOwned ?? false,
      isWishlisted: row.isWishlisted ?? false,
      isWatchlisted: row.isWatchlisted ?? false,
    }));

    // Dedupe: exclude Steam results whose appId is already in library
    const libraryAppIds = new Set(library.map((g) => g.steamAppId));
    const steam: SteamHit[] = (steamResults ?? []).filter(
      (r) => !libraryAppIds.has(r.appId)
    );

    return apiSuccess({ library, steam });
  } catch (error) {
    console.error('[GET /api/search]', error);
    return apiSuccess({ library: [], steam: [] });
  }
}
