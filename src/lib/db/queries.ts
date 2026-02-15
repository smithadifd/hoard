/**
 * Data access layer — all database queries in one place.
 *
 * Server Components and API routes import from here.
 * Pure functions that use the Drizzle ORM query builder.
 */

import { eq, and, or, like, sql, desc, asc, inArray, isNull, lt } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from './index';
import {
  games,
  userGames,
  tags,
  gameTags,
  priceSnapshots,
  priceAlerts,
  settings,
  syncLog,
  user,
} from './schema';
import type { EnrichedGame, GameFilters } from '@/types';
import { calculateDealScore } from '@/lib/scoring/engine';
import type { ScoringWeights, ScoringThresholds } from '@/lib/scoring/types';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from '@/lib/scoring/types';

// ============================================
// Auth Helpers
// ============================================

/**
 * Get the first (and typically only) user's ID.
 * Used by scheduler/sync tasks that run without a request context.
 */
export function getFirstUserId(): string {
  const db = getDb();
  const row = db.select({ id: user.id }).from(user).get();
  if (!row) throw new Error('No users found — run setup first');
  return row.id;
}

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
// Scoring Configuration (cached)
// ============================================

let scoringConfigCache: {
  weights: ScoringWeights;
  thresholds: ScoringThresholds;
  loadedAt: number;
} | null = null;

const SCORING_CACHE_TTL_MS = 60_000; // 1 minute

export function getScoringConfig(): { weights: ScoringWeights; thresholds: ScoringThresholds } {
  const now = Date.now();
  if (scoringConfigCache && (now - scoringConfigCache.loadedAt) < SCORING_CACHE_TTL_MS) {
    return scoringConfigCache;
  }

  let weights: ScoringWeights = DEFAULT_WEIGHTS;
  let thresholds: ScoringThresholds = DEFAULT_THRESHOLDS;

  try {
    const weightsJson = getSetting('scoring_weights');
    if (weightsJson) {
      weights = { ...DEFAULT_WEIGHTS, ...JSON.parse(weightsJson) };
    }
    const thresholdsJson = getSetting('scoring_thresholds');
    if (thresholdsJson) {
      const parsed = JSON.parse(thresholdsJson);
      thresholds = {
        maxDollarsPerHour: { ...DEFAULT_THRESHOLDS.maxDollarsPerHour, ...parsed.maxDollarsPerHour },
      };
    }
  } catch {
    // Malformed JSON — use defaults
  }

  scoringConfigCache = { weights, thresholds, loadedAt: now };
  return { weights, thresholds };
}

// Default: games with < 10% of HLTB completed count as "barely played"
const DEFAULT_BACKLOG_THRESHOLD_PERCENT = 10;
// Absolute fallback for games without HLTB data (minutes)
const BACKLOG_FALLBACK_MINUTES = 15;

export function getBacklogThreshold(): number {
  try {
    const val = getSetting('backlog_threshold_percent');
    if (val) {
      const parsed = parseInt(val, 10);
      if (parsed >= 1 && parsed <= 50) return parsed;
    }
  } catch {
    // Use default
  }
  return DEFAULT_BACKLOG_THRESHOLD_PERCENT;
}

// Play Again defaults
const DEFAULT_PLAY_AGAIN_COMPLETION_PCT = 50;
const DEFAULT_PLAY_AGAIN_DORMANT_MONTHS = 24;
// Absolute hours fallback when HLTB is unavailable
const PLAY_AGAIN_FALLBACK_HOURS = 10;

export function getPlayAgainCompletionPct(): number {
  try {
    const val = getSetting('play_again_completion_pct');
    if (val) {
      const parsed = parseInt(val, 10);
      if (parsed >= 10 && parsed <= 100) return parsed;
    }
  } catch {
    // Use default
  }
  return DEFAULT_PLAY_AGAIN_COMPLETION_PCT;
}

export function getPlayAgainDormantMonths(): number {
  try {
    const val = getSetting('play_again_dormant_months');
    if (val) {
      const parsed = parseInt(val, 10);
      if (parsed >= 1 && parsed <= 120) return parsed;
    }
  } catch {
    // Use default
  }
  return DEFAULT_PLAY_AGAIN_DORMANT_MONTHS;
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
  isReleased?: boolean;
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
      isReleased: data.isReleased,
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
        isReleased: data.isReleased ?? sql`${games.isReleased}`,
        updatedAt: now,
      },
    })
    .returning({ id: games.id })
    .get();

  return result.id;
}

/**
 * Look up existing games by Steam App IDs.
 * Returns a map of steamAppId → { id, title } for games already in the DB.
 */
export function getExistingGamesByAppIds(
  appIds: number[]
): Map<number, { id: number; title: string }> {
  const db = getDb();
  const result = new Map<number, { id: number; title: string }>();
  if (appIds.length === 0) return result;

  // SQLite has a variable limit, batch in groups of 500
  for (let i = 0; i < appIds.length; i += 500) {
    const batch = appIds.slice(i, i + 500);
    const rows = db
      .select({ id: games.id, steamAppId: games.steamAppId, title: games.title })
      .from(games)
      .where(inArray(games.steamAppId, batch))
      .all();
    for (const row of rows) {
      result.set(row.steamAppId, { id: row.id, title: row.title });
    }
  }

  return result;
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

export function upsertUserGame(gameId: number, data: UpsertUserGameData, userId: string): void {
  const db = getDb();
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

function computeDataCompleteness(
  reviewScore: number | null,
  hltbMain: number | null
): 'full' | 'partial' | 'minimal' {
  const hasReviews = reviewScore != null;
  const hasHltb = hltbMain != null && hltbMain > 0;
  if (hasReviews && hasHltb) return 'full';
  if (hasReviews || hasHltb) return 'partial';
  return 'minimal';
}

export function getEnrichedGames(
  filters: GameFilters,
  page: number = 1,
  pageSize: number = 24,
  userId: string = 'default',
): { games: EnrichedGame[]; total: number; totalUnfiltered?: number } {
  const db = getDb();
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

  if (filters.coop === true) {
    conditions.push(sql`${games.isCoop} = 1`);
  } else if (filters.coop === false) {
    conditions.push(sql`(${games.isCoop} IS NULL OR ${games.isCoop} = 0)`);
  }

  if (filters.multiplayer === true) {
    conditions.push(sql`${games.isMultiplayer} = 1`);
  } else if (filters.multiplayer === false) {
    conditions.push(sql`(${games.isMultiplayer} IS NULL OR ${games.isMultiplayer} = 0)`);
  }

  if (filters.minReview !== undefined) {
    if (filters.strictFilters) {
      // Strict: only games with known review score meeting threshold
      conditions.push(sql`${games.reviewScore} IS NOT NULL AND ${games.reviewScore} >= ${filters.minReview}`);
    } else {
      // Lenient: include games with no review data (NULL)
      conditions.push(sql`(${games.reviewScore} IS NULL OR ${games.reviewScore} >= ${filters.minReview})`);
    }
  }

  if (filters.maxReviewCount !== undefined) {
    conditions.push(sql`${games.reviewCount} IS NOT NULL AND ${games.reviewCount} <= ${filters.maxReviewCount}`);
  }

  if (filters.maxHours !== undefined) {
    if (filters.strictFilters) {
      // Strict: only games with known duration within range
      conditions.push(sql`${games.hltbMain} IS NOT NULL AND ${games.hltbMain} <= ${filters.maxHours}`);
    } else {
      // Lenient: include games with no HLTB data (NULL)
      conditions.push(sql`(${games.hltbMain} IS NULL OR ${games.hltbMain} <= ${filters.maxHours})`);
    }
  }

  if (filters.minHours !== undefined) {
    conditions.push(sql`${games.hltbMain} IS NOT NULL AND ${games.hltbMain} >= ${filters.minHours}`);
  }

  if (filters.played === true) {
    conditions.push(sql`${userGames.playtimeMinutes} > 0`);
  } else if (filters.played === false) {
    conditions.push(sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`);
  }

  if (filters.playtimeStatus === 'unplayed') {
    conditions.push(sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`);
  } else if (filters.playtimeStatus === 'underplayed') {
    conditions.push(sql`${userGames.playtimeMinutes} > 0 AND ${userGames.playtimeMinutes} < 60`);
  } else if (filters.playtimeStatus === 'backlog') {
    // Smart backlog: unplayed OR barely started (< X% of HLTB main)
    // For games without HLTB data, use absolute fallback threshold
    const thresholdPct = getBacklogThreshold() / 100.0;
    conditions.push(sql`(
      ${userGames.playtimeMinutes} IS NULL
      OR ${userGames.playtimeMinutes} = 0
      OR (
        ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
        AND (CAST(${userGames.playtimeMinutes} AS REAL) / 60.0) / ${games.hltbMain} < ${thresholdPct}
      )
      OR (
        (${games.hltbMain} IS NULL OR ${games.hltbMain} = 0)
        AND ${userGames.playtimeMinutes} < ${BACKLOG_FALLBACK_MINUTES}
      )
    )`);
  } else if (filters.playtimeStatus === 'play-again') {
    // Play Again: played significantly (>X% of HLTB or >Y hours) AND dormant (last played >Z months ago)
    const completionPct = getPlayAgainCompletionPct() / 100.0;
    const dormantMonths = getPlayAgainDormantMonths();
    conditions.push(sql`(
      ${userGames.lastPlayed} IS NOT NULL
      AND ${userGames.lastPlayed} < datetime('now', '-' || ${dormantMonths} || ' months')
      AND (
        (
          ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
          AND (CAST(${userGames.playtimeMinutes} AS REAL) / 60.0) / ${games.hltbMain} >= ${completionPct}
        )
        OR (
          (${games.hltbMain} IS NULL OR ${games.hltbMain} = 0)
          AND ${userGames.playtimeMinutes} >= ${PLAY_AGAIN_FALLBACK_HOURS * 60}
        )
      )
    )`);
  }

  // Exclude ignored games from backlog and play-again views
  if (filters.playtimeStatus === 'backlog' || filters.playtimeStatus === 'play-again') {
    conditions.push(sql`(${userGames.isIgnored} IS NULL OR ${userGames.isIgnored} = 0)`);
  }

  if (filters.genres && filters.genres.length > 0) {
    conditions.push(
      sql`${games.id} IN (
        SELECT gt.game_id FROM game_tags gt
        INNER JOIN tags t ON gt.tag_id = t.id
        WHERE t.type = 'genre' AND t.name IN (${sql.join(filters.genres.map(g => sql`${g}`), sql`, `)})
      )`
    );
  }

  if (filters.excludeTags && filters.excludeTags.length > 0) {
    conditions.push(
      sql`${games.id} NOT IN (
        SELECT gt.game_id FROM game_tags gt
        INNER JOIN tags t ON gt.tag_id = t.id
        WHERE t.name IN (${sql.join(filters.excludeTags.map(t => sql`${t}`), sql`, `)})
      )`
    );
  }

  if (filters.onSale === true) {
    conditions.push(
      sql`${games.id} IN (
        SELECT ps.game_id FROM price_snapshots ps
        WHERE ps.discount_percent > 0
        AND ps.snapshot_date = (
          SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
          WHERE ps2.game_id = ps.game_id
        )
      )`
    );
  }

  if (filters.requireCompleteData) {
    conditions.push(sql`${games.reviewScore} IS NOT NULL`);
    conditions.push(sql`${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0`);
    conditions.push(sql`${games.id} IN (SELECT ps.game_id FROM price_snapshots ps)`);
  }

  if (filters.hideUnreleased) {
    conditions.push(sql`(${games.isReleased} IS NULL OR ${games.isReleased} = 1)`);
  }

  const where = and(...conditions);

  // Sort mapping — includes subqueries for price/dealScore from latest snapshots.
  // Note: dealScore sort uses the cached snapshot value (can't compute weighted score in SQL).
  // The displayed badges are always recomputed live, so sort order may slightly differ from badges.
  const sortMap = {
    title: games.title,
    playtime: userGames.playtimeMinutes,
    review: games.reviewScore,
    hltbMain: games.hltbMain,
    releaseDate: games.releaseDate,
    lastPlayed: userGames.lastPlayed,
    price: sql`(SELECT ps.price_current FROM price_snapshots ps WHERE ps.game_id = ${games.id} ORDER BY ps.snapshot_date DESC LIMIT 1)`,
    dealScore: sql`(SELECT ps.deal_score FROM price_snapshots ps WHERE ps.game_id = ${games.id} ORDER BY ps.snapshot_date DESC LIMIT 1)`,
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
      isReleased: games.isReleased,
      reviewLastUpdated: games.reviewLastUpdated,
      hltbLastUpdated: games.hltbLastUpdated,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      isIgnored: userGames.isIgnored,
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

  // Count query (filtered)
  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(where)
    .get();
  const total = countResult?.count ?? 0;

  // Unfiltered count for "X of Y" display when data completeness filter is active
  let totalUnfiltered: number | undefined;
  if (filters.requireCompleteData || filters.hideUnreleased) {
    const baseConditions: SQL[] = [eq(userGames.userId, userId)];
    if (filters.view === 'library' || filters.owned === true) {
      baseConditions.push(eq(userGames.isOwned, true));
    }
    if (filters.view === 'wishlist') {
      baseConditions.push(eq(userGames.isWishlisted, true));
    }
    if (filters.view === 'watchlist') {
      baseConditions.push(eq(userGames.isWatchlisted, true));
    }
    const unfilteredResult = db
      .select({ count: sql<number>`count(*)` })
      .from(games)
      .innerJoin(userGames, eq(games.id, userGames.gameId))
      .where(and(...baseConditions))
      .get();
    totalUnfiltered = unfilteredResult?.count ?? 0;
  }

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

  // Batch-fetch latest price snapshots
  const pricesByGame = getLatestPriceSnapshots(gameIds);

  // Map to EnrichedGame
  const enriched: EnrichedGame[] = results.map((r) => {
    const snapshot = pricesByGame.get(r.id);
    const base: EnrichedGame = {
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
      isIgnored: r.isIgnored ?? false,
      playtimeMinutes: r.playtimeMinutes ?? 0,
      personalInterest: r.personalInterest ?? 3,
      lastPlayed: r.lastPlayed ?? undefined,
      tags: tagsByGame.get(r.id)?.tags ?? [],
      genres: tagsByGame.get(r.id)?.genres ?? [],
      isCoop: r.isCoop ?? false,
      isMultiplayer: r.isMultiplayer ?? false,
      isReleased: r.isReleased ?? undefined,
      dataCompleteness: computeDataCompleteness(r.reviewScore, r.hltbMain),
      reviewLastUpdated: r.reviewLastUpdated ?? undefined,
      hltbLastUpdated: r.hltbLastUpdated ?? undefined,
    };

    if (snapshot) {
      base.currentPrice = snapshot.priceCurrent;
      base.regularPrice = snapshot.priceRegular;
      base.discountPercent = snapshot.discountPercent;
      base.historicalLow = snapshot.historicalLowPrice ?? undefined;
      base.isAtHistoricalLow = snapshot.isHistoricalLow;
      base.bestStore = snapshot.store;
      base.storeUrl = snapshot.url ?? undefined;
      base.priceLastUpdated = snapshot.snapshotDate;

      // Always recompute deal score from current weights (not cached snapshot.dealScore)
      // so list badges stay consistent with the detail page after weight changes
      if (snapshot.priceCurrent > 0) {
        const { weights, thresholds } = getScoringConfig();
        const score = calculateDealScore({
          currentPrice: snapshot.priceCurrent,
          regularPrice: snapshot.priceRegular,
          historicalLow: snapshot.historicalLowPrice ?? snapshot.priceCurrent,
          reviewPercent: r.reviewScore,
          hltbMainHours: r.hltbMain,
          personalInterest: r.personalInterest ?? 3,
        }, weights, thresholds);
        base.dealScore = score.overall;
        base.dealRating = score.rating;
        base.dealSummary = score.summary;
        base.dollarsPerHour = score.dollarsPerHour ?? undefined;
      }
    }

    return base;
  });

  return { games: enriched, total, totalUnfiltered };
}

/**
 * Efficient count-only query using the same filter logic as getEnrichedGames.
 * Used for preset match counts where we don't need actual game data.
 */
export function countGames(filters: GameFilters, userId: string): number {
  const db = getDb();
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
  if (filters.coop === true) {
    conditions.push(sql`${games.isCoop} = 1`);
  } else if (filters.coop === false) {
    conditions.push(sql`(${games.isCoop} IS NULL OR ${games.isCoop} = 0)`);
  }
  if (filters.minReview !== undefined) {
    if (filters.strictFilters) {
      conditions.push(sql`${games.reviewScore} IS NOT NULL AND ${games.reviewScore} >= ${filters.minReview}`);
    } else {
      conditions.push(sql`(${games.reviewScore} IS NULL OR ${games.reviewScore} >= ${filters.minReview})`);
    }
  }
  if (filters.maxReviewCount !== undefined) {
    conditions.push(sql`${games.reviewCount} IS NOT NULL AND ${games.reviewCount} <= ${filters.maxReviewCount}`);
  }
  if (filters.maxHours !== undefined) {
    if (filters.strictFilters) {
      conditions.push(sql`${games.hltbMain} IS NOT NULL AND ${games.hltbMain} <= ${filters.maxHours}`);
    } else {
      conditions.push(sql`(${games.hltbMain} IS NULL OR ${games.hltbMain} <= ${filters.maxHours})`);
    }
  }
  if (filters.minHours !== undefined) {
    conditions.push(sql`${games.hltbMain} IS NOT NULL AND ${games.hltbMain} >= ${filters.minHours}`);
  }
  if (filters.playtimeStatus === 'unplayed') {
    conditions.push(sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`);
  } else if (filters.playtimeStatus === 'underplayed') {
    conditions.push(sql`${userGames.playtimeMinutes} > 0 AND ${userGames.playtimeMinutes} < 60`);
  } else if (filters.playtimeStatus === 'backlog') {
    const thresholdPct = getBacklogThreshold() / 100.0;
    conditions.push(sql`(
      ${userGames.playtimeMinutes} IS NULL
      OR ${userGames.playtimeMinutes} = 0
      OR (
        ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
        AND (CAST(${userGames.playtimeMinutes} AS REAL) / 60.0) / ${games.hltbMain} < ${thresholdPct}
      )
      OR (
        (${games.hltbMain} IS NULL OR ${games.hltbMain} = 0)
        AND ${userGames.playtimeMinutes} < ${BACKLOG_FALLBACK_MINUTES}
      )
    )`);
  } else if (filters.playtimeStatus === 'play-again') {
    const completionPct = getPlayAgainCompletionPct() / 100.0;
    const dormantMonths = getPlayAgainDormantMonths();
    conditions.push(sql`(
      ${userGames.lastPlayed} IS NOT NULL
      AND ${userGames.lastPlayed} < datetime('now', '-' || ${dormantMonths} || ' months')
      AND (
        (
          ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
          AND (CAST(${userGames.playtimeMinutes} AS REAL) / 60.0) / ${games.hltbMain} >= ${completionPct}
        )
        OR (
          (${games.hltbMain} IS NULL OR ${games.hltbMain} = 0)
          AND ${userGames.playtimeMinutes} >= ${PLAY_AGAIN_FALLBACK_HOURS * 60}
        )
      )
    )`);
  }
  // Exclude ignored games from backlog and play-again views
  if (filters.playtimeStatus === 'backlog' || filters.playtimeStatus === 'play-again') {
    conditions.push(sql`(${userGames.isIgnored} IS NULL OR ${userGames.isIgnored} = 0)`);
  }
  if (filters.genres && filters.genres.length > 0) {
    conditions.push(
      sql`${games.id} IN (
        SELECT gt.game_id FROM game_tags gt
        INNER JOIN tags t ON gt.tag_id = t.id
        WHERE t.type = 'genre' AND t.name IN (${sql.join(filters.genres.map(g => sql`${g}`), sql`, `)})
      )`
    );
  }
  if (filters.excludeTags && filters.excludeTags.length > 0) {
    conditions.push(
      sql`${games.id} NOT IN (
        SELECT gt.game_id FROM game_tags gt
        INNER JOIN tags t ON gt.tag_id = t.id
        WHERE t.name IN (${sql.join(filters.excludeTags.map(t => sql`${t}`), sql`, `)})
      )`
    );
  }

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(and(...conditions))
    .get();

  return result?.count ?? 0;
}

export function getEnrichedGameById(gameId: number, userId: string): EnrichedGame | null {
  const db = getDb();

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
      isReleased: games.isReleased,
      reviewLastUpdated: games.reviewLastUpdated,
      hltbLastUpdated: games.hltbLastUpdated,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      isIgnored: userGames.isIgnored,
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

  // Fetch latest price snapshot
  const pricesByGame = getLatestPriceSnapshots([gameId]);
  const snapshot = pricesByGame.get(gameId);

  const game: EnrichedGame = {
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
    isIgnored: row.isIgnored ?? false,
    playtimeMinutes: row.playtimeMinutes ?? 0,
    personalInterest: row.personalInterest ?? 3,
    lastPlayed: row.lastPlayed ?? undefined,
    tags: gameTags_,
    genres: gameGenres,
    isCoop: row.isCoop ?? false,
    isMultiplayer: row.isMultiplayer ?? false,
    isReleased: row.isReleased ?? undefined,
    dataCompleteness: computeDataCompleteness(row.reviewScore, row.hltbMain),
    reviewLastUpdated: row.reviewLastUpdated ?? undefined,
    hltbLastUpdated: row.hltbLastUpdated ?? undefined,
  };

  if (snapshot) {
    game.currentPrice = snapshot.priceCurrent;
    game.regularPrice = snapshot.priceRegular;
    game.discountPercent = snapshot.discountPercent;
    game.historicalLow = snapshot.historicalLowPrice ?? undefined;
    game.isAtHistoricalLow = snapshot.isHistoricalLow;
    game.bestStore = snapshot.store;
    game.storeUrl = snapshot.url ?? undefined;
    game.priceLastUpdated = snapshot.snapshotDate;

    if (snapshot.priceCurrent > 0) {
      const { weights, thresholds } = getScoringConfig();
      const score = calculateDealScore({
        currentPrice: snapshot.priceCurrent,
        regularPrice: snapshot.priceRegular,
        historicalLow: snapshot.historicalLowPrice ?? snapshot.priceCurrent,
        reviewPercent: row.reviewScore,
        hltbMainHours: row.hltbMain,
        personalInterest: row.personalInterest ?? 3,
      }, weights, thresholds);
      game.dealScore = score.overall;
      game.dealRating = score.rating;
      game.dealSummary = score.summary;
      game.dollarsPerHour = score.dollarsPerHour ?? undefined;
    }
  }

  return game;
}

// ============================================
// Dashboard Stats
// ============================================

export function getDashboardStats(userId: string): {
  libraryCount: number;
  wishlistCount: number;
  watchlistCount: number;
  totalPlaytimeHours: number;
} {
  const db = getDb();

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

export function getLastSuccessfulSyncBySource(): Record<string, string> {
  const db = getDb();
  const rows = db
    .select({
      source: syncLog.source,
      lastSuccess: sql<string>`MAX(${syncLog.completedAt})`,
    })
    .from(syncLog)
    .where(eq(syncLog.status, 'success'))
    .groupBy(syncLog.source)
    .all();

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.lastSuccess) {
      result[row.source] = row.lastSuccess;
    }
  }
  return result;
}

// ============================================
// Price Queries
// ============================================

export interface PriceSnapshotRow {
  id: number;
  gameId: number;
  store: string;
  priceCurrent: number;
  priceRegular: number;
  discountPercent: number;
  currency: string;
  url: string | null;
  isHistoricalLow: boolean;
  historicalLowPrice: number | null;
  dealScore: number | null;
  snapshotDate: string;
}

export function getGamesForPriceSync(userId: string): Array<{ id: number; steamAppId: number; title: string; itadGameId: string | null }> {
  const db = getDb();

  return db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      itadGameId: games.itadGameId,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        sql`(${userGames.isWishlisted} = 1 OR ${userGames.isWatchlisted} = 1)`
      )
    )
    .all();
}

export function bulkUpdateGameItadIds(updates: Array<{ steamAppId: number; itadGameId: string }>): void {
  const db = getDb();
  const now = new Date().toISOString();

  for (const { steamAppId, itadGameId } of updates) {
    db.update(games)
      .set({ itadGameId, updatedAt: now })
      .where(eq(games.steamAppId, steamAppId))
      .run();
  }
}

// ============================================
// HLTB Sync
// ============================================

// ============================================
// Review Sync
// ============================================

export function getGamesForReviewSync(): Array<{ id: number; steamAppId: number; title: string }> {
  const db = getDb();
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 30); // 30 days

  return db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
    })
    .from(games)
    .where(
      or(
        // Never checked
        isNull(games.reviewLastUpdated),
        // Checked but stale (>30 days) — time to refresh
        lt(games.reviewLastUpdated, staleThreshold.toISOString())
      )
    )
    .orderBy(desc(games.reviewCount))
    .all();
}

export function updateGameReviewData(
  gameId: number,
  data: {
    reviewScore?: number;
    reviewCount?: number;
    reviewDescription?: string;
    description?: string;
    developer?: string;
    publisher?: string;
    isCoop?: boolean;
    isMultiplayer?: boolean;
  }
): void {
  const hasData = Object.keys(data).length > 0;
  const db = getDb();
  db.update(games)
    .set({
      ...(data.reviewScore !== undefined && { reviewScore: data.reviewScore }),
      ...(data.reviewCount !== undefined && { reviewCount: data.reviewCount }),
      ...(data.reviewDescription !== undefined && { reviewDescription: data.reviewDescription }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.developer !== undefined && { developer: data.developer }),
      ...(data.publisher !== undefined && { publisher: data.publisher }),
      ...(data.isCoop !== undefined && { isCoop: data.isCoop }),
      ...(data.isMultiplayer !== undefined && { isMultiplayer: data.isMultiplayer }),
      // Successful: mark as checked for 30 days.
      // Failed: backdate by 27 days so it retries after ~3 days instead of 30.
      reviewLastUpdated: hasData
        ? new Date().toISOString()
        : new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .where(eq(games.id, gameId))
    .run();
}

export function getGamesForHltbSync(): Array<{ id: number; title: string }> {
  const db = getDb();
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 90); // 90 days
  const retryThreshold = new Date();
  retryThreshold.setDate(retryThreshold.getDate() - 7); // 7 days for failed matches

  return db
    .select({
      id: games.id,
      title: games.title,
    })
    .from(games)
    .where(
      or(
        isNull(games.hltbLastUpdated),
        lt(games.hltbLastUpdated, staleThreshold.toISOString()),
        // Retry games that were checked but got no match (transient failures)
        and(
          isNull(games.hltbId),
          lt(games.hltbLastUpdated, retryThreshold.toISOString())
        )
      )
    )
    .orderBy(desc(games.reviewCount))
    .all();
}

export function updateGameHltbData(
  gameId: number,
  data: {
    hltbId?: number;
    hltbMain?: number;
    hltbMainExtra?: number;
    hltbCompletionist?: number;
  }
): void {
  const db = getDb();
  db.update(games)
    .set({
      hltbId: data.hltbId,
      hltbMain: data.hltbMain,
      hltbMainExtra: data.hltbMainExtra,
      hltbCompletionist: data.hltbCompletionist,
      hltbLastUpdated: new Date().toISOString(),
    })
    .where(eq(games.id, gameId))
    .run();
}

export function getHltbCoverage(): { withHltb: number; total: number } {
  const db = getDb();
  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .get();
  const hltbRow = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .where(sql`${games.hltbMain} > 0`)
    .get();
  return {
    withHltb: hltbRow?.count ?? 0,
    total: totalRow?.count ?? 0,
  };
}

export function getReviewCoverage(): { withReviews: number; total: number } {
  const db = getDb();
  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .get();
  const reviewRow = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .where(sql`${games.reviewScore} IS NOT NULL`)
    .get();
  return {
    withReviews: reviewRow?.count ?? 0,
    total: totalRow?.count ?? 0,
  };
}

export function insertPriceSnapshot(data: {
  gameId: number;
  store: string;
  priceCurrent: number;
  priceRegular: number;
  discountPercent: number;
  currency?: string;
  url?: string;
  isHistoricalLow: boolean;
  historicalLowPrice?: number;
  dealScore?: number;
}): void {
  const db = getDb();
  const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  db.insert(priceSnapshots)
    .values({
      gameId: data.gameId,
      store: data.store,
      priceCurrent: data.priceCurrent,
      priceRegular: data.priceRegular,
      discountPercent: data.discountPercent,
      currency: data.currency ?? 'USD',
      url: data.url,
      isHistoricalLow: data.isHistoricalLow,
      historicalLowPrice: data.historicalLowPrice,
      dealScore: data.dealScore,
      snapshotDate: now,
    })
    .run();
}

export function getLatestPriceSnapshots(gameIds: number[]): Map<number, PriceSnapshotRow> {
  if (gameIds.length === 0) return new Map();

  const db = getDb();

  // Use Drizzle's subquery approach: get latest snapshot_date per game, then filter
  const rows = db
    .select()
    .from(priceSnapshots)
    .where(
      and(
        inArray(priceSnapshots.gameId, gameIds),
        sql`${priceSnapshots.snapshotDate} = (
          SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
          WHERE ps2.game_id = ${priceSnapshots.gameId}
        )`
      )
    )
    .all();

  const result = new Map<number, PriceSnapshotRow>();
  for (const row of rows) {
    result.set(row.gameId, {
      id: row.id,
      gameId: row.gameId,
      store: row.store,
      priceCurrent: row.priceCurrent,
      priceRegular: row.priceRegular,
      discountPercent: row.discountPercent ?? 0,
      currency: row.currency ?? 'USD',
      url: row.url,
      isHistoricalLow: row.isHistoricalLow ?? false,
      historicalLowPrice: row.historicalLowPrice,
      dealScore: row.dealScore,
      snapshotDate: row.snapshotDate,
    });
  }
  return result;
}

export function getPriceHistory(gameId: number, limit: number = 90): PriceSnapshotRow[] {
  const db = getDb();

  // Aggregate best (lowest) price per snapshot date across all stores
  interface RawRow {
    id: number;
    gameId: number;
    store: string;
    priceCurrent: number;
    priceRegular: number;
    discountPercent: number;
    currency: string;
    url: string | null;
    isHistoricalLow: number;
    historicalLowPrice: number | null;
    dealScore: number | null;
    snapshotDate: string;
  }

  const rows = db.all(sql`
    SELECT
      ps.id,
      ps.game_id as gameId,
      ps.store,
      ps.price_current as priceCurrent,
      ps.price_regular as priceRegular,
      ps.discount_percent as discountPercent,
      ps.currency,
      ps.url,
      ps.is_historical_low as isHistoricalLow,
      ps.historical_low_price as historicalLowPrice,
      ps.deal_score as dealScore,
      ps.snapshot_date as snapshotDate
    FROM price_snapshots ps
    WHERE ps.game_id = ${gameId}
      AND ps.id = (
        SELECT ps2.id FROM price_snapshots ps2
        WHERE ps2.game_id = ${gameId}
          AND ps2.snapshot_date = ps.snapshot_date
        ORDER BY ps2.price_current ASC
        LIMIT 1
      )
    ORDER BY ps.snapshot_date DESC
    LIMIT ${limit}
  `) as RawRow[];

  return rows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    store: row.store,
    priceCurrent: row.priceCurrent,
    priceRegular: row.priceRegular,
    discountPercent: row.discountPercent ?? 0,
    currency: row.currency ?? 'USD',
    url: row.url,
    isHistoricalLow: Boolean(row.isHistoricalLow),
    historicalLowPrice: row.historicalLowPrice,
    dealScore: row.dealScore,
    snapshotDate: row.snapshotDate,
  }));
}

export function getDealsCount(): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(DISTINCT ${priceSnapshots.gameId})` })
    .from(priceSnapshots)
    .where(
      and(
        sql`${priceSnapshots.discountPercent} > 0`,
        sql`${priceSnapshots.snapshotDate} = (
          SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
          WHERE ps2.game_id = ${priceSnapshots.gameId}
        )`
      )
    )
    .get();
  return row?.count ?? 0;
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
  }>,
  userId: string
): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .update(userGames)
    .set({
      ...updates,
      updatedAt: now,
      // Track when interest was explicitly rated
      ...(updates.personalInterest !== undefined && { interestRatedAt: now }),
    })
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .run();

  if (result.changes === 0) return false;

  // Auto-manage price alert when watchlist/threshold changes
  if (updates.isWatchlisted === false) {
    // Deactivate alert when unwatchlisted
    const existing = db
      .select({ id: priceAlerts.id })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.gameId, gameId), eq(priceAlerts.userId, userId)))
      .get();
    if (existing) {
      db.update(priceAlerts)
        .set({ isActive: false })
        .where(eq(priceAlerts.id, existing.id))
        .run();
    }
  } else if (updates.priceThreshold !== undefined) {
    // Upsert alert with new threshold
    upsertPriceAlert(gameId, { targetPrice: updates.priceThreshold }, userId);
  } else if (updates.isWatchlisted === true) {
    // Ensure alert exists when watchlisting (re-activate if deactivated)
    const existing = db
      .select({ id: priceAlerts.id })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.gameId, gameId), eq(priceAlerts.userId, userId)))
      .get();
    if (existing) {
      db.update(priceAlerts)
        .set({ isActive: true })
        .where(eq(priceAlerts.id, existing.id))
        .run();
    } else {
      // Read current threshold from userGames to seed the alert
      const ug = db
        .select({ priceThreshold: userGames.priceThreshold })
        .from(userGames)
        .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
        .get();
      upsertPriceAlert(gameId, { targetPrice: ug?.priceThreshold ?? undefined }, userId);
    }
  }

  return true;
}

// ============================================
// Backlog / Genre Queries
// ============================================

export function getAllGenres(): string[] {
  const db = getDb();
  const rows = db
    .select({ name: tags.name })
    .from(tags)
    .where(eq(tags.type, 'genre'))
    .orderBy(asc(tags.name))
    .all();
  return rows.map((r) => r.name);
}

export function getBacklogStats(userId: string): { unplayedCount: number; totalOwned: number } {
  const db = getDb();

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isOwned, true)))
    .get();

  const unplayedRow = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(
      and(
        eq(userGames.userId, userId),
        eq(userGames.isOwned, true),
        sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`
      )
    )
    .get();

  return {
    unplayedCount: unplayedRow?.count ?? 0,
    totalOwned: totalRow?.count ?? 0,
  };
}

// ============================================
// Triage (Interest Rating)
// ============================================

export interface TriageGame {
  id: number;
  steamAppId: number;
  title: string;
  headerImageUrl: string | null;
  developer: string | null;
  reviewScore: number | null;
  reviewDescription: string | null;
  hltbMain: number | null;
  currentPrice: number | null;
  personalInterest: number;
  interestRatedAt: string | null;
}

export function getGamesForTriage(view: 'library' | 'wishlist' | undefined, userId: string): TriageGame[] {
  const db = getDb();

  const conditions: SQL[] = [eq(userGames.userId, userId)];

  if (view === 'library') {
    conditions.push(eq(userGames.isOwned, true));
  } else if (view === 'wishlist') {
    conditions.push(eq(userGames.isWishlisted, true));
  }

  // Get all games, unrated first (interestRatedAt IS NULL), then by title
  interface RawRow {
    id: number;
    steamAppId: number;
    title: string;
    headerImageUrl: string | null;
    developer: string | null;
    reviewScore: number | null;
    reviewDescription: string | null;
    hltbMain: number | null;
    personalInterest: number;
    interestRatedAt: string | null;
    currentPrice: number | null;
  }

  const rows = db.all(sql`
    SELECT
      g.id,
      g.steam_app_id as steamAppId,
      g.title,
      g.header_image_url as headerImageUrl,
      g.developer,
      g.review_score as reviewScore,
      g.review_description as reviewDescription,
      g.hltb_main as hltbMain,
      ug.personal_interest as personalInterest,
      ug.interest_rated_at as interestRatedAt,
      (SELECT ps.price_current FROM price_snapshots ps
       WHERE ps.game_id = g.id
       ORDER BY ps.snapshot_date DESC LIMIT 1) as currentPrice
    FROM user_games ug
    INNER JOIN games g ON ug.game_id = g.id
    WHERE ug.user_id = ${userId}
      ${view === 'library' ? sql`AND ug.is_owned = 1` : view === 'wishlist' ? sql`AND ug.is_wishlisted = 1` : sql``}
    ORDER BY
      CASE WHEN ug.interest_rated_at IS NULL THEN 0 ELSE 1 END,
      g.title ASC
  `) as RawRow[];

  return rows.map((r) => ({
    id: r.id,
    steamAppId: r.steamAppId,
    title: r.title,
    headerImageUrl: r.headerImageUrl,
    developer: r.developer,
    reviewScore: r.reviewScore,
    reviewDescription: r.reviewDescription,
    hltbMain: r.hltbMain,
    currentPrice: r.currentPrice,
    personalInterest: r.personalInterest ?? 3,
    interestRatedAt: r.interestRatedAt,
  }));
}

// ============================================
// Price Alerts
// ============================================

export interface PriceAlertRow {
  id: number;
  gameId: number;
  targetPrice: number | null;
  notifyOnAllTimeLow: boolean;
  notifyOnThreshold: boolean;
  isActive: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
}

export interface ActiveAlertRow extends PriceAlertRow {
  title: string;
  headerImageUrl: string | null;
  steamAppId: number;
  reviewDescription: string | null;
  hltbMain: number | null;
  // Latest price snapshot
  currentPrice: number;
  regularPrice: number;
  discountPercent: number;
  historicalLowPrice: number | null;
  isHistoricalLow: boolean;
  store: string;
  storeUrl: string | null;
}

export interface AlertWithGame extends PriceAlertRow {
  title: string;
  headerImageUrl: string | null;
  steamAppId: number;
  currentPrice: number | null;
  regularPrice: number | null;
  discountPercent: number | null;
  historicalLowPrice: number | null;
}

export function upsertPriceAlert(
  gameId: number,
  data: Partial<{
    targetPrice: number;
    notifyOnAllTimeLow: boolean;
    notifyOnThreshold: boolean;
    isActive: boolean;
  }>,
  userId: string
): number {
  const db = getDb();

  const result = db
    .insert(priceAlerts)
    .values({
      userId,
      gameId,
      targetPrice: data.targetPrice,
      notifyOnAllTimeLow: data.notifyOnAllTimeLow ?? true,
      notifyOnThreshold: data.notifyOnThreshold ?? true,
      isActive: data.isActive ?? true,
    })
    .onConflictDoUpdate({
      target: [priceAlerts.userId, priceAlerts.gameId],
      set: {
        // Always set isActive to avoid Drizzle "No values to set" error on empty set
        isActive: data.isActive ?? true,
        ...(data.targetPrice !== undefined && { targetPrice: data.targetPrice }),
        ...(data.notifyOnAllTimeLow !== undefined && { notifyOnAllTimeLow: data.notifyOnAllTimeLow }),
        ...(data.notifyOnThreshold !== undefined && { notifyOnThreshold: data.notifyOnThreshold }),
      },
    })
    .returning({ id: priceAlerts.id })
    .get();

  return result.id;
}

export function getPriceAlertForGame(gameId: number, userId: string): PriceAlertRow | null {
  const db = getDb();

  const row = db
    .select({
      id: priceAlerts.id,
      gameId: priceAlerts.gameId,
      targetPrice: priceAlerts.targetPrice,
      notifyOnAllTimeLow: priceAlerts.notifyOnAllTimeLow,
      notifyOnThreshold: priceAlerts.notifyOnThreshold,
      isActive: priceAlerts.isActive,
      lastNotifiedAt: priceAlerts.lastNotifiedAt,
      createdAt: priceAlerts.createdAt,
    })
    .from(priceAlerts)
    .where(and(eq(priceAlerts.gameId, gameId), eq(priceAlerts.userId, userId)))
    .get();

  if (!row) return null;

  return {
    id: row.id,
    gameId: row.gameId,
    targetPrice: row.targetPrice,
    notifyOnAllTimeLow: row.notifyOnAllTimeLow ?? true,
    notifyOnThreshold: row.notifyOnThreshold ?? true,
    isActive: row.isActive ?? true,
    lastNotifiedAt: row.lastNotifiedAt,
    createdAt: row.createdAt,
  };
}

export function getActivePriceAlerts(userId: string): ActiveAlertRow[] {
  const db = getDb();

  // Raw SQL for the complex join with latest snapshot subquery
  interface RawAlertRow {
    alertId: number;
    gameId: number;
    targetPrice: number | null;
    notifyOnAllTimeLow: number;
    notifyOnThreshold: number;
    lastNotifiedAt: string | null;
    createdAt: string;
    title: string;
    headerImageUrl: string | null;
    steamAppId: number;
    reviewDescription: string | null;
    hltbMain: number | null;
    currentPrice: number;
    regularPrice: number;
    discountPercent: number;
    historicalLowPrice: number | null;
    isHistoricalLow: number;
    store: string;
    storeUrl: string | null;
  }

  const rows = db.all(sql`
    SELECT
      pa.id as alertId,
      pa.game_id as gameId,
      pa.target_price as targetPrice,
      pa.notify_on_all_time_low as notifyOnAllTimeLow,
      pa.notify_on_threshold as notifyOnThreshold,
      pa.last_notified_at as lastNotifiedAt,
      pa.created_at as createdAt,
      g.title,
      g.header_image_url as headerImageUrl,
      g.steam_app_id as steamAppId,
      g.review_description as reviewDescription,
      g.hltb_main as hltbMain,
      ps.price_current as currentPrice,
      ps.price_regular as regularPrice,
      ps.discount_percent as discountPercent,
      ps.historical_low_price as historicalLowPrice,
      ps.is_historical_low as isHistoricalLow,
      ps.store,
      ps.url as storeUrl
    FROM price_alerts pa
    INNER JOIN games g ON pa.game_id = g.id
    INNER JOIN user_games ug ON g.id = ug.game_id AND ug.user_id = ${userId}
    INNER JOIN price_snapshots ps ON g.id = ps.game_id
      AND ps.snapshot_date = (
        SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
        WHERE ps2.game_id = g.id
      )
    WHERE pa.is_active = 1
      AND pa.user_id = ${userId}
      AND ug.is_watchlisted = 1
  `) as RawAlertRow[];

  return rows.map((r) => ({
    id: r.alertId,
    gameId: r.gameId,
    targetPrice: r.targetPrice,
    notifyOnAllTimeLow: Boolean(r.notifyOnAllTimeLow),
    notifyOnThreshold: Boolean(r.notifyOnThreshold),
    isActive: true as const,
    lastNotifiedAt: r.lastNotifiedAt,
    createdAt: r.createdAt,
    title: r.title,
    headerImageUrl: r.headerImageUrl,
    steamAppId: r.steamAppId,
    reviewDescription: r.reviewDescription,
    hltbMain: r.hltbMain,
    currentPrice: r.currentPrice,
    regularPrice: r.regularPrice,
    discountPercent: r.discountPercent,
    historicalLowPrice: r.historicalLowPrice,
    isHistoricalLow: Boolean(r.isHistoricalLow),
    store: r.store,
    storeUrl: r.storeUrl,
  }));
}

export function getAllPriceAlertsWithGames(userId: string): AlertWithGame[] {
  const db = getDb();

  interface RawRow {
    id: number;
    gameId: number;
    targetPrice: number | null;
    notifyOnAllTimeLow: number;
    notifyOnThreshold: number;
    isActive: number;
    lastNotifiedAt: string | null;
    createdAt: string;
    title: string;
    headerImageUrl: string | null;
    steamAppId: number;
    currentPrice: number | null;
    regularPrice: number | null;
    discountPercent: number | null;
    historicalLowPrice: number | null;
  }

  const rows = db.all(sql`
    SELECT
      pa.id,
      pa.game_id as gameId,
      pa.target_price as targetPrice,
      pa.notify_on_all_time_low as notifyOnAllTimeLow,
      pa.notify_on_threshold as notifyOnThreshold,
      pa.is_active as isActive,
      pa.last_notified_at as lastNotifiedAt,
      pa.created_at as createdAt,
      g.title,
      g.header_image_url as headerImageUrl,
      g.steam_app_id as steamAppId,
      ps.price_current as currentPrice,
      ps.price_regular as regularPrice,
      ps.discount_percent as discountPercent,
      ps.historical_low_price as historicalLowPrice
    FROM price_alerts pa
    INNER JOIN games g ON pa.game_id = g.id
    LEFT JOIN price_snapshots ps ON ps.id = (
      SELECT ps2.id FROM price_snapshots ps2
      WHERE ps2.game_id = g.id
      ORDER BY ps2.snapshot_date DESC, ps2.price_current ASC
      LIMIT 1
    )
    WHERE pa.user_id = ${userId}
    ORDER BY pa.is_active DESC, g.title ASC
  `) as RawRow[];

  return rows.map((r) => ({
    id: r.id,
    gameId: r.gameId,
    targetPrice: r.targetPrice,
    notifyOnAllTimeLow: Boolean(r.notifyOnAllTimeLow),
    notifyOnThreshold: Boolean(r.notifyOnThreshold),
    isActive: Boolean(r.isActive),
    lastNotifiedAt: r.lastNotifiedAt,
    createdAt: r.createdAt,
    title: r.title,
    headerImageUrl: r.headerImageUrl,
    steamAppId: r.steamAppId,
    currentPrice: r.currentPrice,
    regularPrice: r.regularPrice,
    discountPercent: r.discountPercent,
    historicalLowPrice: r.historicalLowPrice,
  }));
}

export function updateAlertLastNotified(alertId: number): void {
  const db = getDb();
  db.update(priceAlerts)
    .set({ lastNotifiedAt: new Date().toISOString() })
    .where(eq(priceAlerts.id, alertId))
    .run();
}

export function updatePriceAlert(
  alertId: number,
  updates: Partial<{
    targetPrice: number;
    notifyOnAllTimeLow: boolean;
    notifyOnThreshold: boolean;
    isActive: boolean;
  }>
): boolean {
  const db = getDb();
  const result = db
    .update(priceAlerts)
    .set(updates)
    .where(eq(priceAlerts.id, alertId))
    .run();
  return result.changes > 0;
}

export function deletePriceAlert(alertId: number): boolean {
  const db = getDb();
  const result = db
    .delete(priceAlerts)
    .where(eq(priceAlerts.id, alertId))
    .run();
  return result.changes > 0;
}

export function getAlertStats(userId: string): { activeCount: number; recentlyTriggered: number } {
  const db = getDb();

  const activeRow = db
    .select({ count: sql<number>`count(*)` })
    .from(priceAlerts)
    .where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.isActive, true)))
    .get();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const triggeredRow = db
    .select({ count: sql<number>`count(*)` })
    .from(priceAlerts)
    .where(
      and(
        eq(priceAlerts.userId, userId),
        sql`${priceAlerts.lastNotifiedAt} IS NOT NULL AND ${priceAlerts.lastNotifiedAt} >= ${weekAgo.toISOString()}`
      )
    )
    .get();

  return {
    activeCount: activeRow?.count ?? 0,
    recentlyTriggered: triggeredRow?.count ?? 0,
  };
}
