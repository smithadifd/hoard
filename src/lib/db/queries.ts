/**
 * Data access layer — all database queries in one place.
 *
 * Server Components and API routes import from here.
 * Pure functions that use the Drizzle ORM query builder.
 */

import { eq, and, like, sql, desc, asc, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from './index';
import {
  games,
  userGames,
  tags,
  gameTags,
  settings,
  syncLog,
} from './schema';
import type { EnrichedGame, GameFilters } from '@/types';

// ============================================
// Settings
// ============================================

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string, description?: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(settings)
    .values({ key, value, description, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now, ...(description !== undefined && { description }) },
    })
    .run();
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.select({ key: settings.key, value: settings.value }).from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ============================================
// Game Upserts (used by sync)
// ============================================

export interface UpsertGameData {
  steamAppId: number;
  title: string;
  headerImageUrl?: string;
  description?: string;
  shortDescription?: string;
  releaseDate?: string;
  developer?: string;
  publisher?: string;
  reviewScore?: number;
  reviewCount?: number;
  reviewDescription?: string;
  isCoop?: boolean;
  isMultiplayer?: boolean;
}

export function upsertGameFromSteam(data: UpsertGameData): number {
  const db = getDb();
  const now = new Date().toISOString();
  const headerImage =
    data.headerImageUrl ||
    `https://cdn.akamai.steamstatic.com/steam/apps/${data.steamAppId}/header.jpg`;

  const result = db
    .insert(games)
    .values({
      steamAppId: data.steamAppId,
      title: data.title,
      headerImageUrl: headerImage,
      description: data.description,
      shortDescription: data.shortDescription,
      releaseDate: data.releaseDate,
      developer: data.developer,
      publisher: data.publisher,
      reviewScore: data.reviewScore,
      reviewCount: data.reviewCount,
      reviewDescription: data.reviewDescription,
      isCoop: data.isCoop,
      isMultiplayer: data.isMultiplayer,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: games.steamAppId,
      set: {
        title: data.title,
        headerImageUrl: headerImage,
        // Preserve existing values when new data is undefined
        description: data.description ?? sql`${games.description}`,
        shortDescription: data.shortDescription ?? sql`${games.shortDescription}`,
        releaseDate: data.releaseDate ?? sql`${games.releaseDate}`,
        developer: data.developer ?? sql`${games.developer}`,
        publisher: data.publisher ?? sql`${games.publisher}`,
        reviewScore: data.reviewScore ?? sql`${games.reviewScore}`,
        reviewCount: data.reviewCount ?? sql`${games.reviewCount}`,
        reviewDescription: data.reviewDescription ?? sql`${games.reviewDescription}`,
        isCoop: data.isCoop ?? sql`${games.isCoop}`,
        isMultiplayer: data.isMultiplayer ?? sql`${games.isMultiplayer}`,
        updatedAt: now,
      },
    })
    .returning({ id: games.id })
    .get();

  return result.id;
}

export interface UpsertUserGameData {
  isOwned?: boolean;
  isWishlisted?: boolean;
  isWatchlisted?: boolean;
  isIgnored?: boolean;
  playtimeMinutes?: number;
  playtimeRecentMinutes?: number;
  lastPlayed?: string;
  personalInterest?: number;
  priceThreshold?: number;
  notes?: string;
}

export function upsertUserGame(gameId: number, data: UpsertUserGameData): void {
  const db = getDb();
  const userId = 'default';
  const now = new Date().toISOString();

  db.insert(userGames)
    .values({
      userId,
      gameId,
      isOwned: data.isOwned ?? false,
      isWishlisted: data.isWishlisted ?? false,
      isWatchlisted: data.isWatchlisted ?? false,
      isIgnored: data.isIgnored ?? false,
      playtimeMinutes: data.playtimeMinutes ?? 0,
      playtimeRecentMinutes: data.playtimeRecentMinutes ?? 0,
      lastPlayed: data.lastPlayed,
      personalInterest: data.personalInterest ?? 3,
      priceThreshold: data.priceThreshold,
      notes: data.notes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userGames.userId, userGames.gameId],
      set: {
        // Only update fields that are explicitly provided
        ...(data.isOwned !== undefined && { isOwned: data.isOwned }),
        ...(data.isWishlisted !== undefined && { isWishlisted: data.isWishlisted }),
        ...(data.isWatchlisted !== undefined && { isWatchlisted: data.isWatchlisted }),
        ...(data.isIgnored !== undefined && { isIgnored: data.isIgnored }),
        ...(data.playtimeMinutes !== undefined && { playtimeMinutes: data.playtimeMinutes }),
        ...(data.playtimeRecentMinutes !== undefined && { playtimeRecentMinutes: data.playtimeRecentMinutes }),
        ...(data.lastPlayed !== undefined && { lastPlayed: data.lastPlayed }),
        ...(data.personalInterest !== undefined && { personalInterest: data.personalInterest }),
        ...(data.priceThreshold !== undefined && { priceThreshold: data.priceThreshold }),
        ...(data.notes !== undefined && { notes: data.notes }),
        updatedAt: now,
      },
    })
    .run();
}

export function upsertTags(gameId: number, tagNames: string[], type: string): void {
  const db = getDb();

  for (const name of tagNames) {
    // Upsert the tag itself
    const tag = db
      .insert(tags)
      .values({ name, type })
      .onConflictDoUpdate({
        target: [tags.name, tags.type],
        set: { name }, // no-op update to get the returning id
      })
      .returning({ id: tags.id })
      .get();

    // Upsert the game-tag association
    db.insert(gameTags)
      .values({ gameId, tagId: tag.id })
      .onConflictDoNothing()
      .run();
  }
}

// ============================================
// Game Queries
// ============================================

export function getEnrichedGames(
  filters: GameFilters,
  page: number = 1,
  pageSize: number = 24
): { games: EnrichedGame[]; total: number } {
  const db = getDb();
  const userId = 'default';
  const offset = (page - 1) * pageSize;

  // Build WHERE conditions
  const conditions: SQL[] = [eq(userGames.userId, userId)];

  if (filters.view === 'library' || filters.owned === true) {
    conditions.push(eq(userGames.isOwned, true));
  }
  if (filters.view === 'wishlist') {
    conditions.push(eq(userGames.isWishlisted, true));
  }
  if (filters.view === 'watchlist') {
    conditions.push(eq(userGames.isWatchlisted, true));
  }

  if (filters.search) {
    conditions.push(like(games.title, `%${filters.search}%`));
  }

  if (filters.coop !== undefined) {
    conditions.push(eq(games.isCoop, filters.coop));
  }

  if (filters.multiplayer !== undefined) {
    conditions.push(eq(games.isMultiplayer, filters.multiplayer));
  }

  if (filters.minReview !== undefined) {
    conditions.push(sql`${games.reviewScore} >= ${filters.minReview}`);
  }

  if (filters.maxHours !== undefined) {
    conditions.push(sql`(${games.hltbMain} IS NULL OR ${games.hltbMain} <= ${filters.maxHours})`);
  }

  if (filters.minHours !== undefined) {
    conditions.push(sql`${games.hltbMain} >= ${filters.minHours}`);
  }

  if (filters.played === true) {
    conditions.push(sql`${userGames.playtimeMinutes} > 0`);
  } else if (filters.played === false) {
    conditions.push(sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`);
  }

  if (filters.onSale === true) {
    // Phase 2 — skip for now, no price data yet
  }

  const where = and(...conditions);

  // Sort mapping
  const sortMap = {
    title: games.title,
    playtime: userGames.playtimeMinutes,
    review: games.reviewScore,
    hltbMain: games.hltbMain,
    releaseDate: games.releaseDate,
  } as const;
  type SortKey = keyof typeof sortMap;
  const sortKey = (filters.sortBy && filters.sortBy in sortMap ? filters.sortBy : 'title') as SortKey;
  const sortColumn = sortMap[sortKey];
  const sortDir = filters.sortOrder === 'desc' ? desc : asc;

  // Main query
  const results = db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      description: games.description,
      shortDescription: games.shortDescription,
      headerImageUrl: games.headerImageUrl,
      releaseDate: games.releaseDate,
      developer: games.developer,
      publisher: games.publisher,
      reviewScore: games.reviewScore,
      reviewCount: games.reviewCount,
      reviewDescription: games.reviewDescription,
      hltbMain: games.hltbMain,
      hltbMainExtra: games.hltbMainExtra,
      hltbCompletionist: games.hltbCompletionist,
      isCoop: games.isCoop,
      isMultiplayer: games.isMultiplayer,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      playtimeMinutes: userGames.playtimeMinutes,
      personalInterest: userGames.personalInterest,
      lastPlayed: userGames.lastPlayed,
      notes: userGames.notes,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(where)
    .orderBy(sortDir(sortColumn))
    .limit(pageSize)
    .offset(offset)
    .all();

  // Count query
  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(where)
    .get();
  const total = countResult?.count ?? 0;

  // Batch-fetch tags for returned games
  const gameIds = results.map((r) => r.id);
  const tagRows =
    gameIds.length > 0
      ? db
          .select({
            gameId: gameTags.gameId,
            name: tags.name,
            type: tags.type,
          })
          .from(gameTags)
          .innerJoin(tags, eq(gameTags.tagId, tags.id))
          .where(inArray(gameTags.gameId, gameIds))
          .all()
      : [];

  // Group tags by gameId
  const tagsByGame = new Map<number, { tags: string[]; genres: string[] }>();
  for (const t of tagRows) {
    if (!tagsByGame.has(t.gameId)) {
      tagsByGame.set(t.gameId, { tags: [], genres: [] });
    }
    const bucket = tagsByGame.get(t.gameId)!;
    if (t.type === 'genre') bucket.genres.push(t.name);
    else bucket.tags.push(t.name);
  }

  // Map to EnrichedGame
  const enriched: EnrichedGame[] = results.map((r) => ({
    id: r.id,
    steamAppId: r.steamAppId,
    title: r.title,
    description: r.description ?? undefined,
    headerImageUrl: r.headerImageUrl ?? undefined,
    releaseDate: r.releaseDate ?? undefined,
    developer: r.developer ?? undefined,
    publisher: r.publisher ?? undefined,
    reviewScore: r.reviewScore ?? undefined,
    reviewCount: r.reviewCount ?? undefined,
    reviewDescription: r.reviewDescription ?? undefined,
    hltbMain: r.hltbMain ?? undefined,
    hltbMainExtra: r.hltbMainExtra ?? undefined,
    hltbCompletionist: r.hltbCompletionist ?? undefined,
    isOwned: r.isOwned ?? false,
    isWishlisted: r.isWishlisted ?? false,
    isWatchlisted: r.isWatchlisted ?? false,
    playtimeMinutes: r.playtimeMinutes ?? 0,
    personalInterest: r.personalInterest ?? 3,
    tags: tagsByGame.get(r.id)?.tags ?? [],
    genres: tagsByGame.get(r.id)?.genres ?? [],
    isCoop: r.isCoop ?? false,
    isMultiplayer: r.isMultiplayer ?? false,
  }));

  return { games: enriched, total };
}

export function getEnrichedGameById(gameId: number): EnrichedGame | null {
  const db = getDb();
  const userId = 'default';

  const row = db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      description: games.description,
      shortDescription: games.shortDescription,
      headerImageUrl: games.headerImageUrl,
      releaseDate: games.releaseDate,
      developer: games.developer,
      publisher: games.publisher,
      reviewScore: games.reviewScore,
      reviewCount: games.reviewCount,
      reviewDescription: games.reviewDescription,
      hltbMain: games.hltbMain,
      hltbMainExtra: games.hltbMainExtra,
      hltbCompletionist: games.hltbCompletionist,
      isCoop: games.isCoop,
      isMultiplayer: games.isMultiplayer,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      playtimeMinutes: userGames.playtimeMinutes,
      personalInterest: userGames.personalInterest,
      lastPlayed: userGames.lastPlayed,
      notes: userGames.notes,
    })
    .from(games)
    .leftJoin(
      userGames,
      and(eq(games.id, userGames.gameId), eq(userGames.userId, userId))
    )
    .where(eq(games.id, gameId))
    .get();

  if (!row) return null;

  // Fetch tags for this game
  const tagRows = db
    .select({ name: tags.name, type: tags.type })
    .from(gameTags)
    .innerJoin(tags, eq(gameTags.tagId, tags.id))
    .where(eq(gameTags.gameId, gameId))
    .all();

  const gameGenres: string[] = [];
  const gameTags_: string[] = [];
  for (const t of tagRows) {
    if (t.type === 'genre') gameGenres.push(t.name);
    else gameTags_.push(t.name);
  }

  return {
    id: row.id,
    steamAppId: row.steamAppId,
    title: row.title,
    description: row.description ?? undefined,
    headerImageUrl: row.headerImageUrl ?? undefined,
    releaseDate: row.releaseDate ?? undefined,
    developer: row.developer ?? undefined,
    publisher: row.publisher ?? undefined,
    reviewScore: row.reviewScore ?? undefined,
    reviewCount: row.reviewCount ?? undefined,
    reviewDescription: row.reviewDescription ?? undefined,
    hltbMain: row.hltbMain ?? undefined,
    hltbMainExtra: row.hltbMainExtra ?? undefined,
    hltbCompletionist: row.hltbCompletionist ?? undefined,
    isOwned: row.isOwned ?? false,
    isWishlisted: row.isWishlisted ?? false,
    isWatchlisted: row.isWatchlisted ?? false,
    playtimeMinutes: row.playtimeMinutes ?? 0,
    personalInterest: row.personalInterest ?? 3,
    tags: gameTags_,
    genres: gameGenres,
    isCoop: row.isCoop ?? false,
    isMultiplayer: row.isMultiplayer ?? false,
  };
}

// ============================================
// Dashboard Stats
// ============================================

export function getDashboardStats(): {
  libraryCount: number;
  wishlistCount: number;
  watchlistCount: number;
  totalPlaytimeHours: number;
} {
  const db = getDb();
  const userId = 'default';

  const libraryRow = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isOwned, true)))
    .get();

  const wishlistRow = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isWishlisted, true)))
    .get();

  const watchlistRow = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isWatchlisted, true)))
    .get();

  const playtimeRow = db
    .select({
      total: sql<number>`coalesce(sum(${userGames.playtimeMinutes}), 0)`,
    })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isOwned, true)))
    .get();

  return {
    libraryCount: libraryRow?.count ?? 0,
    wishlistCount: wishlistRow?.count ?? 0,
    watchlistCount: watchlistRow?.count ?? 0,
    totalPlaytimeHours: Math.round((playtimeRow?.total ?? 0) / 60),
  };
}

// ============================================
// Sync Log
// ============================================

export function createSyncLog(source: string): number {
  const db = getDb();
  const result = db
    .insert(syncLog)
    .values({ source, status: 'running' })
    .returning({ id: syncLog.id })
    .get();
  return result.id;
}

export function completeSyncLog(
  id: number,
  status: 'success' | 'error',
  itemsProcessed: number,
  errorMessage?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(syncLog)
    .set({
      status,
      itemsProcessed,
      errorMessage,
      completedAt: now,
    })
    .where(eq(syncLog.id, id))
    .run();
}

export function getRecentSyncLogs(limit: number = 20) {
  const db = getDb();
  return db
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.startedAt))
    .limit(limit)
    .all();
}

// ============================================
// User Game Updates (for PATCH endpoint)
// ============================================

export function updateUserGame(
  gameId: number,
  updates: Partial<{
    personalInterest: number;
    notes: string;
    isWatchlisted: boolean;
    isIgnored: boolean;
    priceThreshold: number;
  }>
): boolean {
  const db = getDb();
  const userId = 'default';
  const now = new Date().toISOString();

  const result = db
    .update(userGames)
    .set({ ...updates, updatedAt: now })
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .run();

  return result.changes > 0;
}
