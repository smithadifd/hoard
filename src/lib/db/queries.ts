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
  playtimeSnapshots,
  priceAlerts,
  settings,
  syncLog,
  user,
} from './schema';
import type { EnrichedGame, GameFilters } from '@/types';
import { calculateDealScore, getEffectivePlaytimeHours } from '@/lib/scoring/engine';
import { STEAM_PLAYTIME_GIVE_UP_MISSES, type PlaytimeSource } from '@/lib/playtimeSource';

// Re-exported so existing server callers can keep importing from '@/lib/db/queries'.
export { STEAM_PLAYTIME_GIVE_UP_MISSES };
import { calculateValueReceived, type ValueReceivedTier } from '@/lib/scoring/valueReceived';
import { buildDphTargetSql } from '@/lib/scoring/reviewTierLadder';
import type { ScoringWeights, ScoringThresholds } from '@/lib/scoring/types';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from '@/lib/scoring/types';
import type { NotificationPreferences, ChannelRouting, NotificationCategory } from '@/lib/notifications/preferences';
import { DEFAULT_PREFERENCES, NOTIFICATION_CATEGORIES } from '@/lib/notifications/preferences';
import { curateDisplayTags } from '@/lib/utils/tags';

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
      const merged: typeof DEFAULT_THRESHOLDS.maxDollarsPerHour = {
        ...DEFAULT_THRESHOLDS.maxDollarsPerHour,
        ...parsed.maxDollarsPerHour,
      };
      // Belt-and-suspenders: clamp any persisted zero/negative/non-finite
      // threshold to a safe floor so the value-received engine never divides by
      // zero even for rows written before validation existed.
      const DPH_FLOOR = 0.01;
      for (const key of Object.keys(merged) as Array<keyof typeof merged>) {
        const v = merged[key];
        if (!isFinite(v) || v <= 0) {
          merged[key] = DPH_FLOOR;
        }
      }
      thresholds = { maxDollarsPerHour: merged };
    }
  } catch {
    // Malformed JSON — use defaults
  }

  scoringConfigCache = { weights, thresholds, loadedAt: now };
  return { weights, thresholds };
}

// ============================================
// Notification Preferences (cached)
// ============================================

let notificationPrefsCache: { prefs: NotificationPreferences; loadedAt: number } | null = null;
const NOTIFICATION_PREFS_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Load notification delivery preferences, deep-merged over DEFAULT_PREFERENCES
 * so a partial stored blob never drops newly-added fields. Cached for 60s,
 * mirroring getScoringConfig.
 *
 * Back-compat: when the stored blob doesn't carry a per-game throttle, the
 * legacy `alert_throttle_hours` setting seeds it (then the built-in default).
 */
export function getNotificationPreferences(): NotificationPreferences {
  const now = Date.now();
  if (notificationPrefsCache && now - notificationPrefsCache.loadedAt < NOTIFICATION_PREFS_CACHE_TTL_MS) {
    return notificationPrefsCache.prefs;
  }

  // Build fresh from defaults (deep-cloned) so we never mutate the shared const.
  const prefs: NotificationPreferences = {
    categories: {} as Record<NotificationCategory, ChannelRouting>,
    frequency: { ...DEFAULT_PREFERENCES.frequency },
    quietHours: { ...DEFAULT_PREFERENCES.quietHours },
  };
  for (const cat of NOTIFICATION_CATEGORIES) {
    prefs.categories[cat] = { ...DEFAULT_PREFERENCES.categories[cat] };
  }

  let blobHadThrottle = false;
  let blobHadDigestHour = false;
  try {
    const json = getSetting('notification_preferences');
    if (json) {
      const parsed = JSON.parse(json) as Partial<NotificationPreferences>;
      if (parsed.categories) {
        for (const cat of NOTIFICATION_CATEGORIES) {
          const stored = parsed.categories[cat];
          if (stored) {
            prefs.categories[cat] = {
              inApp: typeof stored.inApp === 'boolean' ? stored.inApp : prefs.categories[cat].inApp,
              discord: typeof stored.discord === 'boolean' ? stored.discord : prefs.categories[cat].discord,
            };
          }
        }
      }
      if (parsed.frequency && typeof parsed.frequency.throttleHours === 'number') {
        prefs.frequency.throttleHours = parsed.frequency.throttleHours;
        blobHadThrottle = true;
      }
      if (parsed.frequency && typeof parsed.frequency.digestHour === 'number') {
        prefs.frequency.digestHour = clampDigestHour(parsed.frequency.digestHour, prefs.frequency.digestHour);
        blobHadDigestHour = true;
      }
      if (parsed.quietHours) {
        const q = parsed.quietHours;
        prefs.quietHours = {
          enabled: typeof q.enabled === 'boolean' ? q.enabled : prefs.quietHours.enabled,
          start: typeof q.start === 'number' ? q.start : prefs.quietHours.start,
          end: typeof q.end === 'number' ? q.end : prefs.quietHours.end,
        };
      }
    }
  } catch {
    // Malformed JSON — fall back to defaults
  }

  // Back-compat: when the blob omits a throttle, seed from the legacy
  // `alert_throttle_hours` setting, then the ALERT_THROTTLE_HOURS env var, then
  // the built-in default. This keeps the getter the single source of throttle
  // truth so both the settings UI and getEffectiveConfig() agree.
  if (!blobHadThrottle) {
    let seed: string | null | undefined;
    try {
      seed = getSetting('alert_throttle_hours');
    } catch {
      seed = null;
    }
    if (!seed) seed = process.env.ALERT_THROTTLE_HOURS;
    if (seed) {
      const parsed = parseInt(seed, 10);
      if (Number.isFinite(parsed) && parsed >= 1) prefs.frequency.throttleHours = parsed;
    }
  }

  // Digest hour: when the blob omits it, seed from the ATL_DIGEST_HOUR env var, then
  // the built-in default — same single-source-of-truth pattern as the throttle above.
  if (!blobHadDigestHour && process.env.ATL_DIGEST_HOUR) {
    const parsed = parseInt(process.env.ATL_DIGEST_HOUR, 10);
    prefs.frequency.digestHour = clampDigestHour(parsed, prefs.frequency.digestHour);
  }

  notificationPrefsCache = { prefs, loadedAt: now };
  return prefs;
}

/** Coerce a digest hour to a valid 0–23 integer, falling back on out-of-range/NaN input. */
function clampDigestHour(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 23) return fallback;
  return Math.floor(value);
}

// Default: games with < 10% of HLTB completed count as "barely played"
const DEFAULT_BACKLOG_THRESHOLD_PERCENT = 10;
// Absolute fallback for games without HLTB data (minutes)
const BACKLOG_FALLBACK_MINUTES = 15;

// Play Again defaults
const DEFAULT_PLAY_AGAIN_COMPLETION_PCT = 50;
const DEFAULT_PLAY_AGAIN_DORMANT_MONTHS = 24;
// Absolute hours fallback when HLTB is unavailable
const PLAY_AGAIN_FALLBACK_HOURS = 10;

function readBacklogThreshold(): number {
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

function readPlayAgainCompletionPct(): number {
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

function readPlayAgainDormantMonths(): number {
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

// The backlog/play-again thresholds are read on every backlog render — the main
// getEnrichedGames query plus 6 preset countGames calls each rebuild filter
// conditions, re-reading these settings ~7×. Cache the resolved values for a
// short window, mirroring the getScoringConfig cache (TTL-only, no write
// invalidation — edits take effect within the TTL).
const THRESHOLD_CACHE_TTL_MS = 60_000; // 1 minute
let thresholdCache: {
  backlog: number;
  playAgainCompletionPct: number;
  playAgainDormantMonths: number;
  loadedAt: number;
} | null = null;

function getThresholds() {
  const now = Date.now();
  if (thresholdCache && now - thresholdCache.loadedAt < THRESHOLD_CACHE_TTL_MS) {
    return thresholdCache;
  }
  thresholdCache = {
    backlog: readBacklogThreshold(),
    playAgainCompletionPct: readPlayAgainCompletionPct(),
    playAgainDormantMonths: readPlayAgainDormantMonths(),
    loadedAt: now,
  };
  return thresholdCache;
}

export function getBacklogThreshold(): number {
  return getThresholds().backlog;
}

export function getPlayAgainCompletionPct(): number {
  return getThresholds().playAgainCompletionPct;
}

export function getPlayAgainDormantMonths(): number {
  return getThresholds().playAgainDormantMonths;
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
  // Only store image URLs supplied by Steam's API. The legacy CDN path
  // (cdn.akamai.steamstatic.com/steam/apps/{id}/header.jpg) is not populated
  // for newer apps — Steam serves them from asset-versioned URLs returned by
  // the appdetails API. Storing null lets the UI render a placeholder.

  const result = db
    .insert(games)
    .values({
      steamAppId: data.steamAppId,
      title: data.title,
      headerImageUrl: data.headerImageUrl,
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
        // Preserve existing image URL when new data has none, so subsequent
        // library syncs (which never pass headerImageUrl) don't overwrite a
        // good URL from an earlier wishlist sync with null.
        headerImageUrl: data.headerImageUrl ?? sql`${games.headerImageUrl}`,
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
  wishlistedLocally?: boolean;
  wishlistedAt?: string; // ISO; set-if-null only (see upsertUserGame) — true Steam wishlist-add date
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
      wishlistedLocally: data.wishlistedLocally ?? false,
      wishlistedAt: data.wishlistedAt,
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
        ...(data.wishlistedLocally !== undefined && { wishlistedLocally: data.wishlistedLocally }),
        // Set-if-null: keep the earliest captured date; never overwrite a stored value.
        ...(data.wishlistedAt !== undefined && {
          wishlistedAt: sql`COALESCE(${userGames.wishlistedAt}, ${data.wishlistedAt})`,
        }),
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

  // Personal interest feeds the deal score's interest component. When the user
  // (re)rates it, refresh the stored snapshot score so deal-score sorts match
  // the live badge. Bulk sync upserts don't pass personalInterest, so they skip
  // this.
  if (data.personalInterest !== undefined) recomputeLatestSnapshotDealScore(gameId);
}

/**
 * Returns gameIds for the given user where the user_games row currently has
 * isOwned=false (or no row at all). Used by library sync to detect ownership
 * transitions before the bulk upsert overwrites the prior state.
 */
export function getPreOwnershipState(
  gameIds: number[],
  userId: string,
): { wasOwned: boolean; wasWishlisted: boolean; gameId: number }[] {
  if (gameIds.length === 0) return [];
  const db = getDb();
  const rows = db
    .select({
      gameId: userGames.gameId,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      wishlistRemovedAt: userGames.wishlistRemovedAt,
    })
    .from(userGames)
    .where(and(
      eq(userGames.userId, userId),
      inArray(userGames.gameId, gameIds),
    ))
    .all();
  return rows.map((r) => ({
    gameId: r.gameId,
    wasOwned: r.isOwned ?? false,
    wasWishlisted: (r.isWishlisted ?? false) && r.wishlistRemovedAt == null,
  }));
}

/**
 * Cascade for ownership transitions (false → true). Steam is the source of
 * truth for ownership, so once a wishlisted game shows up in the library:
 *   - any active price alerts are deactivated (you own it, no reason to keep notifying)
 *   - it's removed from the wishlist (you don't wishlist what you own)
 *
 * Caller passes the set of gameIds that just transitioned; runs in a single
 * transaction with the library upserts (caller is responsible for the txn).
 */
export function cascadePurchaseCleanup(gameIds: number[], userId: string): void {
  if (gameIds.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();

  db.update(priceAlerts)
    .set({ isActive: false })
    .where(and(
      eq(priceAlerts.userId, userId),
      eq(priceAlerts.isActive, true),
      inArray(priceAlerts.gameId, gameIds),
    ))
    .run();

  db.update(userGames)
    .set({
      isWishlisted: false,
      isWatchlisted: false,
      wishlistedLocally: false,
      wishlistRemovedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(userGames.userId, userId),
      inArray(userGames.gameId, gameIds),
    ))
    .run();
}

/**
 * Fraction of the currently-owned library that a single reconcile run is allowed
 * to unmark. A run that would unown MORE than this is treated as a truncated /
 * globally-wrong owned set and refused wholesale — this is the last-line
 * defense-in-depth for the one destructive mass-write path in the sync (a wrong
 * fire is worse than leaving stale ownership one extra cycle).
 */
export const RECONCILE_MAX_UNOWN_FRACTION = 0.5;

/**
 * Reconcile ownership after a library sync: any game the user currently owns
 * that is ABSENT from the freshly-synced owned set is set `isOwned=false`
 * (refund, revoked license, family-share change). `ownedGameIds` is the set of
 * gameIds confirmed owned by THIS sync run.
 *
 * CALLER GUARD (load-bearing): only call this for a genuine, successful,
 * PROVABLY-COMPLETE, NON-EMPTY owned response from a run that completed (not
 * cancelled). A transient empty/failed response, OR a truncated-but-successful
 * one, must never reach here — otherwise the missing games get wrongly unowned.
 * See syncLibrary for the completeness (game_count) + non-empty + not-cancelled
 * gates.
 *
 * TWO internal safety nets on top of the caller's gates:
 *   1. an empty confirmed set (`ownedGameIds` == []) is never trusted as "you
 *      own nothing" — refuse to unmark anything;
 *   2. a SANITY CAP (RECONCILE_MAX_UNOWN_FRACTION) refuses any run that would
 *      unown more than half the current library — catches an internally-
 *      consistent but globally-wrong owned set (e.g. Steam's game_count itself
 *      truncated low) that the caller's completeness check can't detect.
 *
 * Diffs currently-owned rows against the confirmed set in JS and unmarks only
 * the absent ones (batched by 500 like getExistingGamesByAppIds — avoids a giant
 * NOT IN and its SQLite variable-limit hazard). Returns the count unmarked (0 if
 * a safety net skipped the run). Pure synchronous DB writes — safe inside the
 * syncLibrary transaction.
 */
export function reconcileOwnership(ownedGameIds: number[], userId: string): number {
  // Safety net 1: an empty confirmed set is never trusted to mean "you own
  // nothing" — refuse to unmark anything. Callers must still gate on a genuine,
  // provably-complete, non-empty owned response (see syncLibrary).
  if (ownedGameIds.length === 0) return 0;

  const db = getDb();
  const ownedSet = new Set(ownedGameIds);
  const currentlyOwned = db
    .select({ gameId: userGames.gameId })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isOwned, true)))
    .all()
    .map((r) => r.gameId);
  const toUnown = currentlyOwned.filter((id) => !ownedSet.has(id));
  if (toUnown.length === 0) return 0;

  // Safety net 2: sanity cap. Refuse a run that would unown more than half the
  // current library — a legitimate mass-refund at that scale is vanishingly rare
  // versus a truncated owned set, so we skip loudly rather than mass-delete.
  if (toUnown.length > currentlyOwned.length * RECONCILE_MAX_UNOWN_FRACTION) {
    console.warn(
      `[reconcileOwnership] Refusing to unmark ${toUnown.length}/${currentlyOwned.length} owned games ` +
      `(> ${RECONCILE_MAX_UNOWN_FRACTION * 100}% of the library) — likely a truncated owned set; skipping`,
    );
    return 0;
  }

  const now = new Date().toISOString();
  for (let i = 0; i < toUnown.length; i += 500) {
    const batch = toUnown.slice(i, i + 500);
    db.update(userGames)
      .set({ isOwned: false, updatedAt: now })
      .where(and(eq(userGames.userId, userId), inArray(userGames.gameId, batch)))
      .run();
  }
  return toUnown.length;
}

/**
 * Capture a price-paid *suggestion* for newly-purchased games (Phase 3).
 *
 * Called at wishlist→owned detection (see syncLibrary) for the games that just
 * flipped. For each game with no recorded price yet, estimate what the user
 * likely paid from the *last tracked price* — the cheapest store's current price
 * on the most recent snapshot date we hold. All snapshots are USD (BASE_CURRENCY
 * ingest filter), so no conversion. This is only ever a suggestion: it's written
 * to `pricePaidSuggested`, never to `pricePaid`, and becomes the real price only
 * on an explicit user confirm.
 *
 * Honest boundary: a game with no snapshot (never wishlisted long enough to be
 * price-synced, or owned before Hoard) gets no suggestion — we don't fabricate a
 * number. Returns the rows it actually set so the caller can notify.
 *
 * Pure synchronous DB writes — safe to call inside the syncLibrary transaction.
 */
export function capturePricePaidSuggestions(
  gameIds: number[],
  userId: string,
): { gameId: number; title: string; suggested: number; asOf: string }[] {
  if (gameIds.length === 0) return [];
  const db = getDb();
  const now = new Date().toISOString();
  const captured: { gameId: number; title: string; suggested: number; asOf: string }[] = [];

  for (const gameId of gameIds) {
    // Never clobber a price the user already recorded.
    const ug = db
      .select({ pricePaid: userGames.pricePaid, title: games.title })
      .from(userGames)
      .innerJoin(games, eq(games.id, userGames.gameId))
      .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
      .get();
    if (!ug || ug.pricePaid != null) continue;

    // Last tracked price = cheapest store's current price on the latest snapshot
    // date for this game. No snapshot ⇒ no suggestion (the honest boundary).
    const snap = db
      .select({
        priceCurrent: priceSnapshots.priceCurrent,
        snapshotDate: priceSnapshots.snapshotDate,
      })
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.gameId, gameId),
          sql`${priceSnapshots.snapshotDate} = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE game_id = ${gameId})`,
        ),
      )
      .orderBy(asc(priceSnapshots.priceCurrent))
      .limit(1)
      .get();
    // No snapshot, or a free/$0 price → no suggestion (a "you paid $0" prompt is
    // meaningless; mirrors how the money lens treats free games).
    if (!snap || snap.priceCurrent == null || snap.priceCurrent <= 0) continue;

    db.update(userGames)
      .set({
        pricePaidSuggested: snap.priceCurrent,
        // Clear any stale dismissal so a fresh purchase re-surfaces the estimate.
        pricePaidSuggestionDismissedAt: null,
        updatedAt: now,
      })
      .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
      .run();

    captured.push({ gameId, title: ug.title, suggested: snap.priceCurrent, asOf: snap.snapshotDate });
  }

  return captured;
}

export function upsertTags(gameId: number, tagNames: string[], type: string): void {
  const db = getDb();
  const sqlite = db.$client;

  const runUpserts = sqlite.transaction(() => {
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
  });
  runUpserts();
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

/**
 * Build the WHERE conditions for game queries from a GameFilters object.
 * Shared by getEnrichedGames, countGames, and any future query variants.
 */
function buildGameFilterConditions(filters: GameFilters, userId: string): SQL[] {
  const conditions: SQL[] = [eq(userGames.userId, userId)];

  if (filters.view === 'library' || filters.owned === true) {
    conditions.push(eq(userGames.isOwned, true));
  }
  if (filters.view === 'wishlist') {
    conditions.push(eq(userGames.isWishlisted, true));
    conditions.push(sql`${userGames.wishlistRemovedAt} IS NULL`);
  }
  if (filters.view === 'watchlist') {
    conditions.push(eq(userGames.isWatchlisted, true));
  }
  if (filters.view === 'recent-deals') {
    // Surface games where any snapshot in the last N days was at the all-time low.
    // No wishlist/library/watchlist scope — anything we've tracked qualifies.
    const days = Math.floor(filters.daysBack && filters.daysBack > 0 ? filters.daysBack : 30);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM price_snapshots ps_atl
      WHERE ps_atl.game_id = ${games.id}
        AND ps_atl.is_historical_low = 1
        AND ps_atl.snapshot_date >= date('now', '-' || ${days} || ' days')
    )`);
  }
  if (filters.view === 'new-atls') {
    // Games whose FIRST-EVER hit at the current ATL price falls within the window.
    // "First-ever" means no prior snapshot has a price equal to or lower than this one.
    const days = Math.floor(filters.daysBack && filters.daysBack > 0 ? filters.daysBack : 14);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM price_snapshots ps_atl
      WHERE ps_atl.game_id = ${games.id}
        AND ps_atl.is_historical_low = 1
        AND ps_atl.snapshot_date >= date('now', '-' || ${days} || ' days')
        AND NOT EXISTS (
          SELECT 1 FROM price_snapshots ps_prior
          WHERE ps_prior.game_id = ps_atl.game_id
            AND ps_prior.snapshot_date < ps_atl.snapshot_date
            AND ps_prior.price_current <= ps_atl.price_current
        )
    )`);
  }
  if (filters.view === 'deepest-discounts') {
    // Wishlisted (not owned) games sorted by latest discount %.
    conditions.push(eq(userGames.isWishlisted, true));
    conditions.push(sql`${userGames.wishlistRemovedAt} IS NULL`);
    conditions.push(sql`(${userGames.isOwned} IS NULL OR ${userGames.isOwned} = 0)`);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM price_snapshots ps
      WHERE ps.game_id = ${games.id}
        AND ps.id = (
          SELECT ps2.id FROM price_snapshots ps2
          WHERE ps2.game_id = ${games.id}
          ORDER BY ps2.snapshot_date DESC, ps2.deal_score DESC
          LIMIT 1
        )
        AND ps.discount_percent > 0
    )`);
  }
  if (filters.view === 'heating-up') {
    // Wishlisted (not owned) games whose current price is at least 15% below
    // the average of the last 90 days (a meaningful step beyond the baseline).
    conditions.push(eq(userGames.isWishlisted, true));
    conditions.push(sql`${userGames.wishlistRemovedAt} IS NULL`);
    conditions.push(sql`(${userGames.isOwned} IS NULL OR ${userGames.isOwned} = 0)`);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM price_snapshots ps_latest
      WHERE ps_latest.game_id = ${games.id}
        AND ps_latest.id = (
          SELECT ps2.id FROM price_snapshots ps2
          WHERE ps2.game_id = ${games.id}
          ORDER BY ps2.snapshot_date DESC LIMIT 1
        )
        AND (
          SELECT AVG(ps_avg.price_current) FROM price_snapshots ps_avg
          WHERE ps_avg.game_id = ${games.id}
            AND ps_avg.snapshot_date >= date('now', '-90 days')
        ) IS NOT NULL
        AND ps_latest.price_current <= 0.85 * (
          SELECT AVG(ps_avg.price_current) FROM price_snapshots ps_avg
          WHERE ps_avg.game_id = ${games.id}
            AND ps_avg.snapshot_date >= date('now', '-90 days')
        )
    )`);
  }

  if (filters.excludeGameIds && filters.excludeGameIds.length > 0) {
    conditions.push(sql`${games.id} NOT IN (${sql.join(filters.excludeGameIds.map((id) => sql`${id}`), sql`, `)})`);
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

  if (filters.played === true) {
    conditions.push(sql`${userGames.playtimeMinutes} > 0`);
  } else if (filters.played === false) {
    conditions.push(sql`(${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} = 0)`);
  }

  // Value Received: rated vs unrated (owned library) — a plain column check on the
  // user's post-play enjoyment rating, no scoring involved.
  if (filters.rated === true) {
    conditions.push(sql`${userGames.enjoymentRating} IS NOT NULL`);
  } else if (filters.rated === false) {
    conditions.push(sql`${userGames.enjoymentRating} IS NULL`);
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
        WHERE LOWER(t.name) IN (${sql.join(filters.excludeTags.map(t => sql`${t.toLowerCase()}`), sql`, `)})
      )`
    );
  }

  if (filters.maxPrice !== undefined) {
    conditions.push(
      sql`${games.id} IN (
        SELECT ps.game_id FROM price_snapshots ps
        WHERE ps.price_current <= ${filters.maxPrice}
        AND ps.snapshot_date = (
          SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
          WHERE ps2.game_id = ps.game_id
        )
      )`
    );
  } else if (filters.onSale === true) {
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

  if (filters.minInterest !== undefined) {
    conditions.push(sql`${userGames.personalInterest} >= ${filters.minInterest}`);
  }

  return conditions;
}

// ============================================
// EnrichedGame enrichment helpers
// Shared by getEnrichedGames, getEnrichedGameById, and getUnreleasedWishlistGames
// so new EnrichedGame fields / scoring changes are edited in one place.
// ============================================

interface TagBucket {
  tags: string[];
  genres: string[];
}

/**
 * Fold a single game's tag rows into { tags, genres }. Non-genre tags (Steam
 * categories) are curated down to the decision-relevant set — see
 * `curateDisplayTags`.
 */
function groupTags(tagRows: { name: string; type: string }[]): TagBucket {
  const bucket: TagBucket = { tags: [], genres: [] };
  for (const t of tagRows) {
    if (t.type === 'genre') bucket.genres.push(t.name);
    else bucket.tags.push(t.name);
  }
  bucket.tags = curateDisplayTags(bucket.tags);
  return bucket;
}

/**
 * Fold multi-game tag rows into a per-gameId { tags, genres } map. Non-genre
 * tags are curated per game — see `curateDisplayTags`.
 */
function groupTagsByGame(
  tagRows: { gameId: number; name: string; type: string }[],
): Map<number, TagBucket> {
  const byGame = new Map<number, TagBucket>();
  for (const t of tagRows) {
    let bucket = byGame.get(t.gameId);
    if (!bucket) {
      bucket = { tags: [], genres: [] };
      byGame.set(t.gameId, bucket);
    }
    if (t.type === 'genre') bucket.genres.push(t.name);
    else bucket.tags.push(t.name);
  }
  for (const bucket of byGame.values()) {
    bucket.tags = curateDisplayTags(bucket.tags);
  }
  return byGame;
}

const EMPTY_TAG_BUCKET: TagBucket = { tags: [], genres: [] };

/** The games+userGames columns common to every EnrichedGame query. */
interface BaseEnrichedRow {
  id: number;
  steamAppId: number;
  title: string;
  source: string | null;
  headerImageUrl: string | null;
  releaseDate: string | null;
  developer: string | null;
  publisher: string | null;
  reviewScore: number | null;
  reviewCount: number | null;
  reviewDescription: string | null;
  hltbMain: number | null;
  hltbMainExtra: number | null;
  hltbCompletionist: number | null;
  steamPlaytimeMedian: number | null;
  steamPlaytimeSampleSize: number | null;
  playtimeSource: string | null;
  isOwned: boolean | null;
  isWishlisted: boolean | null;
  isWatchlisted: boolean | null;
  isIgnored: boolean | null;
  wishlistedLocally: boolean | null;
  autoAlertDisabled: boolean | null;
  playtimeMinutes: number | null;
  personalInterest: number | null;
  lastPlayed: string | null;
  isCoop: boolean | null;
  isMultiplayer: boolean | null;
  isReleased: boolean | null;
  isEarlyAccess: boolean | null;
  reviewLastUpdated: string | null;
  hltbLastUpdated: string | null;
  metadataLastUpdated: string | null;
}

/** Map the shared base columns to an EnrichedGame. Callers layer on the
 *  view-specific fields (atlHitDate/dealBadge, description, snapshot, value-received). */
function mapBaseEnrichedGame(r: BaseEnrichedRow, bucket: TagBucket): EnrichedGame {
  return {
    id: r.id,
    steamAppId: r.steamAppId,
    title: r.title,
    source: r.source === 'lookup' ? 'lookup' : 'sync',
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
    steamPlaytimeMedian: r.steamPlaytimeMedian ?? undefined,
    steamPlaytimeSampleSize: r.steamPlaytimeSampleSize ?? undefined,
    playtimeSource: r.playtimeSource === 'steam_reviews' ? 'steam_reviews' : 'hltb',
    isOwned: r.isOwned ?? false,
    isWishlisted: r.isWishlisted ?? false,
    isWatchlisted: r.isWatchlisted ?? false,
    isIgnored: r.isIgnored ?? false,
    wishlistedLocally: r.wishlistedLocally ?? false,
    autoAlertDisabled: r.autoAlertDisabled ?? false,
    playtimeMinutes: r.playtimeMinutes ?? 0,
    personalInterest: r.personalInterest ?? 3,
    lastPlayed: r.lastPlayed ?? undefined,
    tags: bucket.tags,
    genres: bucket.genres,
    isCoop: r.isCoop ?? false,
    isMultiplayer: r.isMultiplayer ?? false,
    isReleased: r.isReleased ?? undefined,
    isEarlyAccess: r.isEarlyAccess ?? undefined,
    dataCompleteness: computeDataCompleteness(r.reviewScore, r.hltbMain),
    reviewLastUpdated: r.reviewLastUpdated ?? undefined,
    hltbLastUpdated: r.hltbLastUpdated ?? undefined,
    metadataLastUpdated: r.metadataLastUpdated ?? undefined,
  };
}

/** Apply the latest price snapshot's fields + a LIVE-recomputed deal score to a
 *  game (recompute, not the cached snapshot.dealScore, so list/detail badges stay
 *  consistent after weight changes). Mutates `game` in place. */
function applySnapshotToGame(
  game: EnrichedGame,
  snapshot: PriceSnapshotRow,
  scoreInputs: {
    reviewScore: number | null;
    hltbMain: number | null;
    steamPlaytimeMedian: number | null;
    playtimeSource: string | null;
    personalInterest: number | null;
  },
): void {
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
      reviewPercent: scoreInputs.reviewScore,
      hltbMainHours: getEffectivePlaytimeHours({ ...scoreInputs, isReleased: game.isReleased ?? null }),
      personalInterest: scoreInputs.personalInterest ?? 3,
    }, weights, thresholds);
    game.dealScore = score.overall;
    game.dealRating = score.rating;
    game.dealSummary = score.summary;
    game.dollarsPerHour = score.dollarsPerHour ?? undefined;
  }
}

/**
 * Recompute and persist `deal_score` on a game's most-recent price snapshot(s)
 * from the game's CURRENT scoring inputs (review %, HLTB hours, personal
 * interest, live weights). Returns true if any stored score changed.
 *
 * Why this exists: the wishlist and other deal-score sorts read the stored
 * `price_snapshots.deal_score` (the weighted score can't be expressed in SQL),
 * while the on-card / detail badge is always recomputed live in
 * `applySnapshotToGame`. The stored score is frozen at snapshot-write time, so
 * when an input lands AFTER the latest snapshot — e.g. HLTB matches hours after
 * a sale-day price sync and no price change since means no new snapshot — the
 * stored score keeps its stale (often value-neutral) value and the game sorts
 * far below where its badge says it belongs. Call this whenever an input
 * changes so the sort key stays in sync with the badge.
 *
 * All snapshots sharing the latest `snapshot_date` are refreshed (each from its
 * own price) so the value is correct regardless of which same-day row a given
 * query picks for the badge vs. the sort.
 */
export function recomputeLatestSnapshotDealScore(gameId: number): boolean {
  const db = getDb();

  const game = db
    .select({
      reviewScore: games.reviewScore,
      hltbMain: games.hltbMain,
      steamPlaytimeMedian: games.steamPlaytimeMedian,
      isReleased: games.isReleased,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  if (!game) return false;

  const interestRow = db
    .select({
      personalInterest: userGames.personalInterest,
      playtimeSource: userGames.playtimeSource,
    })
    .from(userGames)
    .where(eq(userGames.gameId, gameId))
    .get();
  const personalInterest = interestRow?.personalInterest ?? 3;
  const effectiveHours = getEffectivePlaytimeHours({
    playtimeSource: interestRow?.playtimeSource ?? 'hltb',
    hltbMain: game.hltbMain,
    steamPlaytimeMedian: game.steamPlaytimeMedian,
    isReleased: game.isReleased,
  });

  const latest = db
    .select()
    .from(priceSnapshots)
    .where(
      and(
        eq(priceSnapshots.gameId, gameId),
        sql`${priceSnapshots.snapshotDate} = (
          SELECT MAX(ps2.snapshot_date) FROM price_snapshots ps2
          WHERE ps2.game_id = ${priceSnapshots.gameId}
        )`,
      ),
    )
    .all();
  if (latest.length === 0) return false;

  const { weights, thresholds } = getScoringConfig();
  let changed = false;
  for (const snap of latest) {
    if (snap.priceCurrent <= 0) continue;
    const score = calculateDealScore(
      {
        currentPrice: snap.priceCurrent,
        regularPrice: snap.priceRegular,
        historicalLow: snap.historicalLowPrice ?? snap.priceCurrent,
        reviewPercent: game.reviewScore,
        hltbMainHours: effectiveHours,
        personalInterest,
      },
      weights,
      thresholds,
    );
    if (score.overall !== snap.dealScore) {
      db.update(priceSnapshots).set({ dealScore: score.overall }).where(eq(priceSnapshots.id, snap.id)).run();
      changed = true;
    }
  }
  return changed;
}

/**
 * Refresh the stored deal score on every game's latest snapshot. Used as a
 * one-time backfill (stale scores written before enrichment landed) and after a
 * scoring-weights change (which shifts every score). Returns the number of games
 * whose stored score changed.
 */
export function recomputeAllLatestDealScores(): number {
  const db = getDb();
  const ids = db
    .selectDistinct({ gameId: priceSnapshots.gameId })
    .from(priceSnapshots)
    .all();
  let changed = 0;
  for (const { gameId } of ids) {
    if (recomputeLatestSnapshotDealScore(gameId)) changed++;
  }
  return changed;
}

/** Apply the owned-game value-received enrichment (the "did I get my money's
 *  worth?" fields) to a game. Mutates `game` in place. */
function applyValueReceivedToGame(
  game: EnrichedGame,
  r: {
    playtimeMinutes: number | null;
    hltbMain: number | null;
    steamPlaytimeMedian: number | null;
    playtimeSource: string | null;
    reviewScore: number | null;
    pricePaid: number | null;
    enjoymentRating: number | null;
    personalInterest: number | null;
    interestRatedAt: string | null;
    pricePaidSuggested: number | null;
    pricePaidSuggestionDismissedAt: string | null;
  },
): void {
  const { thresholds } = getScoringConfig();
  const vr = calculateValueReceived(
    {
      playtimeMinutes: r.playtimeMinutes ?? 0,
      hltbMainHours: getEffectivePlaytimeHours(r),
      reviewPercent: r.reviewScore,
      pricePaid: r.pricePaid,
      enjoymentRating: r.enjoymentRating,
      personalInterest: r.personalInterest,
      interestRatedAt: r.interestRatedAt,
    },
    thresholds,
  );
  game.pricePaid = r.pricePaid ?? undefined;
  game.pricePaidSuggested = r.pricePaidSuggested ?? undefined;
  game.hasPricePaidSuggestion =
    r.pricePaid == null && r.pricePaidSuggested != null && r.pricePaidSuggestionDismissedAt == null;
  game.valueReceivedTier = vr.tier;
  game.valueReceivedLens = vr.lens;
  game.completionRatio = vr.completionRatio;
  game.realizedDollarsPerHour = vr.realizedDollarsPerHour ?? undefined;
  game.hoursToBreakEven = vr.hoursToBreakEven ?? undefined;
  game.receivedExpectedValue = vr.receivedExpectedValue ?? undefined;
  game.valueReceivedSummary = vr.summary;
  game.enjoymentRating = vr.enjoymentRating ?? undefined;
  game.valueReceivedHeadline = vr.verdict?.headline;
  game.valueReceivedQualifier = vr.verdict?.qualifier ?? undefined;
  game.betPayoff = vr.betPayoff ?? undefined;
}

export function getEnrichedGames(
  filters: GameFilters,
  page: number = 1,
  pageSize: number = 24,
  userId: string = 'default',
): { games: EnrichedGame[]; total: number; totalUnfiltered?: number } {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const conditions = buildGameFilterConditions(filters, userId);

  // Value Received tier expressions — the ONE source of truth shared by the tier FILTER
  // (below) and the `valueReceived` SORT (in sortMap), so a game's tier can never drift
  // between the two. Mirrors calculateValueReceived's moneyTier/timeTier bands using the
  // user's LIVE configured $/hr thresholds. Computed in SQL so it survives pagination.
  const { thresholds: vrThresholds } = getScoringConfig();
  const dphT = vrThresholds.maxDollarsPerHour;
  const hoursPlayedExpr = sql`(CAST(${userGames.playtimeMinutes} AS REAL) / 60.0)`;
  // Per-game $/hr target, picked by review tier. Generated from the SHARED
  // REVIEW_TIER_LADDER (src/lib/scoring/reviewTierLadder.ts) so this SQL and the TS
  // getMaxDollarsPerHour can never drift — reviewTierLadder.test.ts pins them together.
  const dphTargetExpr = buildDphTargetSql(games.reviewScore, dphT);
  // Effective playtime basis (hours) — mirrors resolveEffectivePlaytime / getEffectivePlaytimeHours,
  // the SAME resolver getValueReceivedOverview (the donut) and the per-card badges use (both call it
  // WITHOUT isReleased, so the released-game fallback below is never suppressed for them): an explicit
  // steam_reviews preference takes the Steam-review median (then HLTB); otherwise HLTB, falling back to
  // the median when HLTB is missing. steam_playtime_median is stored in hours, like hltb_main. Without
  // this, a released HLTB-less game with a review median reads "Realized" on its card AND in the donut,
  // yet fell out of every tier filter — the surfaces would silently disagree.
  const effectiveHoursExpr = sql`(CASE
    WHEN ${userGames.playtimeSource} = 'steam_reviews' THEN COALESCE(${games.steamPlaytimeMedian}, ${games.hltbMain})
    WHEN ${games.hltbMain} IS NOT NULL THEN ${games.hltbMain}
    WHEN ${games.isReleased} = 0 THEN NULL
    ELSE ${games.steamPlaytimeMedian} END)`;
  // Discrete Value Received tier ordinal (exceeded 4 → unrealized 1), mirroring
  // calculateValueReceived's tier: money lens first (priced + played), then time lens graded off the
  // EFFECTIVE playtime basis above (so it matches the donut + card badges), then never-played →
  // unrealized. Rating does NOT enter here. NULL = no baseline to grade ('none' — excluded from filters).
  const valueTierOrdinalExpr = sql`(CASE
    WHEN ${userGames.pricePaid} IS NOT NULL AND ${userGames.pricePaid} > 0 AND ${userGames.playtimeMinutes} > 0 THEN
      CASE
        WHEN (${userGames.pricePaid} / ${hoursPlayedExpr}) <= ${dphTargetExpr} * 0.5 THEN 4
        WHEN (${userGames.pricePaid} / ${hoursPlayedExpr}) <= ${dphTargetExpr} THEN 3
        WHEN (${userGames.pricePaid} / ${hoursPlayedExpr}) <= ${dphTargetExpr} * 2 THEN 2
        ELSE 1 END
    WHEN ${effectiveHoursExpr} > 0 AND ${userGames.playtimeMinutes} > 0 THEN
      CASE
        WHEN (${hoursPlayedExpr} / ${effectiveHoursExpr}) >= 1.1 THEN 4
        WHEN (${hoursPlayedExpr} / ${effectiveHoursExpr}) >= 0.8 THEN 3
        WHEN (${hoursPlayedExpr} / ${effectiveHoursExpr}) >= 0.2 THEN 2
        ELSE 1 END
    WHEN ${userGames.playtimeMinutes} IS NULL OR ${userGames.playtimeMinutes} <= 0 THEN 1
    ELSE NULL END)`;

  // Value Received tier filter — surfaces exactly the games the donut buckets into this tier
  // (exceeded/realized/approaching/unrealized), because it reuses the shared ordinal above, which
  // grades off the SAME effective playtime basis as the donut and the per-card badges. No new
  // scoring — it just selects on the existing computation.
  if (filters.valueReceivedTier) {
    const tierOrdinal: Record<NonNullable<GameFilters['valueReceivedTier']>, number> = {
      unrealized: 1,
      approaching: 2,
      realized: 3,
      exceeded: 4,
    };
    conditions.push(sql`${valueTierOrdinalExpr} = ${tierOrdinal[filters.valueReceivedTier]}`);
  }

  // Snapshot conditions before data-quality filters so totalUnfiltered still applies search/genre/value/etc.
  const conditionsWithoutDataFilters = [...conditions];

  if (filters.requireCompleteData) {
    // A game is "deal-ready" when it has a price to judge and a review to anchor
    // quality — enough to inform a buy/wait decision. HLTB is intentionally NOT
    // required: many released games (and every unreleased one) will never get an
    // HLTB match, and hiding a priced, well-reviewed sale for a gap we can't fill
    // buries real opportunities. Such games still surface, but with a
    // low-confidence deal badge (see GameCard / the game detail page) so the
    // missing $/hr value signal is disclosed rather than hidden.
    conditions.push(sql`${games.reviewScore} IS NOT NULL`);
    conditions.push(sql`${games.id} IN (SELECT ps.game_id FROM price_snapshots ps)`);
  }

  if (filters.hideUnreleased) {
    conditions.push(sql`(${games.isReleased} IS NULL OR ${games.isReleased} = 1)`);
  }

  if (filters.earlyAccess === true) {
    conditions.push(sql`${games.isEarlyAccess} = 1`);
  } else if (filters.earlyAccess === false) {
    conditions.push(sql`(${games.isEarlyAccess} IS NULL OR ${games.isEarlyAccess} = 0)`);
  }

  const where = and(...conditions);

  // Value Received sorts are computed per-game in JS (calculateValueReceived) AFTER
  // pagination, so they must be expressed in SQL to survive paging. They reuse the shared
  // tier expressions defined above (hoursPlayedExpr / dphTargetExpr / valueTierOrdinalExpr).

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
    // For view='new-atls', filter to genuinely-new ATL hits (matches the
    // displayed atlHitDate field) so sort order and badge date agree.
    atlHitDate: filters.view === 'new-atls'
      ? sql`(
          SELECT MAX(ps.snapshot_date) FROM price_snapshots ps
          WHERE ps.game_id = ${games.id}
            AND ps.is_historical_low = 1
            AND NOT EXISTS (
              SELECT 1 FROM price_snapshots ps_prior
              WHERE ps_prior.game_id = ps.game_id
                AND ps_prior.snapshot_date < ps.snapshot_date
                AND ps_prior.price_current <= ps.price_current
            )
        )`
      : sql`(SELECT MAX(ps.snapshot_date) FROM price_snapshots ps WHERE ps.game_id = ${games.id} AND ps.is_historical_low = 1)`,
    discount: sql`(SELECT ps.discount_percent FROM price_snapshots ps WHERE ps.game_id = ${games.id} ORDER BY ps.snapshot_date DESC LIMIT 1)`,
    belowAvgPercent: sql`(
      SELECT 100.0 * (1.0 - ps_latest.price_current / NULLIF((
        SELECT AVG(ps_avg.price_current) FROM price_snapshots ps_avg
        WHERE ps_avg.game_id = ${games.id}
          AND ps_avg.snapshot_date >= date('now', '-90 days')
      ), 0))
      FROM price_snapshots ps_latest
      WHERE ps_latest.game_id = ${games.id}
        AND ps_latest.id = (
          SELECT ps2.id FROM price_snapshots ps2
          WHERE ps2.game_id = ${games.id}
          ORDER BY ps2.snapshot_date DESC LIMIT 1
        )
    )`,
    // "Most Value Waiting" — surfaces owned games that are highly rated, of high
    // personal interest, and have lots of unplayed main-story content left. The
    // backward-looking mirror of dealScore for the backlog: review quality
    // (NULL→50%) × interest factor (0.25–1.25) × remaining unplayed hours, where
    // remaining = (1 − min(1, completion)) × hltbMain. Games without HLTB sizing
    // contribute 0 remaining hours, so they sort last (honest: we can't claim
    // unplayed value we can't measure). MAX/MIN are SQLite's 2-arg scalar forms.
    valueWaiting: sql`(
      COALESCE(${games.reviewScore}, 50) / 100.0
      * (((COALESCE(${userGames.personalInterest}, 3) - 1) / 4.0) + 0.25)
      * (CASE
           WHEN ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
             THEN MAX(0.0, (1.0 - MIN(1.0, (CAST(${userGames.playtimeMinutes} AS REAL) / 60.0) / ${games.hltbMain})) * ${games.hltbMain})
           ELSE 0.0
         END)
    )`,
    // Owned-game Value Received sorts (backward-looking; NULL for games we can't grade,
    // which SQLite sorts last under the common DESC direction).
    pricePaid: userGames.pricePaid,
    completionRatio: sql`(CASE
      WHEN ${games.hltbMain} IS NOT NULL AND ${games.hltbMain} > 0
        THEN ${hoursPlayedExpr} / ${games.hltbMain}
      ELSE NULL END)`,
    realizedDollarsPerHour: sql`(CASE
      WHEN ${userGames.pricePaid} IS NOT NULL AND ${userGames.pricePaid} > 0 AND ${userGames.playtimeMinutes} > 0
        THEN ${userGames.pricePaid} / ${hoursPlayedExpr}
      ELSE NULL END)`,
    // The user's own verdict leads when they've rated a game (enjoymentRating 1-5, so a 5★
    // tops everything and a 1★ "regret" sinks); otherwise fall back to the efficiency/
    // completion tier ordinal (1-4) shared with the value-tier filter above — one source of
    // truth, so sort order and the tier filter can never drift. NULL (no baseline) sorts last.
    valueReceived: sql`(CASE
      WHEN ${userGames.enjoymentRating} IS NOT NULL THEN ${userGames.enjoymentRating}
      ELSE ${valueTierOrdinalExpr} END)`,
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
      hltbManual: games.hltbManual,
      steamPlaytimeMedian: games.steamPlaytimeMedian,
      steamPlaytimeSampleSize: games.steamPlaytimeSampleSize,
      isCoop: games.isCoop,
      isMultiplayer: games.isMultiplayer,
      isReleased: games.isReleased,
      isEarlyAccess: games.isEarlyAccess,
      source: games.source,
      reviewLastUpdated: games.reviewLastUpdated,
      hltbLastUpdated: games.hltbLastUpdated,
      metadataLastUpdated: games.metadataLastUpdated,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      isIgnored: userGames.isIgnored,
      wishlistedLocally: userGames.wishlistedLocally,
      autoAlertDisabled: userGames.autoAlertDisabled,
      playtimeMinutes: userGames.playtimeMinutes,
      personalInterest: userGames.personalInterest,
      playtimeSource: userGames.playtimeSource,
      interestRatedAt: userGames.interestRatedAt,
      enjoymentRating: userGames.enjoymentRating,
      lastPlayed: userGames.lastPlayed,
      pricePaid: userGames.pricePaid,
      pricePaidSuggested: userGames.pricePaidSuggested,
      pricePaidSuggestionDismissedAt: userGames.pricePaidSuggestionDismissedAt,
      atlHitDate:
        filters.view === 'recent-deals'
          ? sql<string | null>`(SELECT MAX(ps.snapshot_date) FROM price_snapshots ps WHERE ps.game_id = ${games.id} AND ps.is_historical_low = 1)`
          : filters.view === 'new-atls'
          ? sql<string | null>`(
              SELECT MAX(ps.snapshot_date) FROM price_snapshots ps
              WHERE ps.game_id = ${games.id}
                AND ps.is_historical_low = 1
                AND NOT EXISTS (
                  SELECT 1 FROM price_snapshots ps_prior
                  WHERE ps_prior.game_id = ps.game_id
                    AND ps_prior.snapshot_date < ps.snapshot_date
                    AND ps_prior.price_current <= ps.price_current
                )
            )`
          : sql<string | null>`NULL`,
      belowAvgPercent:
        filters.view === 'heating-up'
          ? sql<number | null>`(
              SELECT
                ROUND(
                  100.0 * (1.0 - ps_latest.price_current / NULLIF((
                    SELECT AVG(ps_avg.price_current) FROM price_snapshots ps_avg
                    WHERE ps_avg.game_id = ${games.id}
                      AND ps_avg.snapshot_date >= date('now', '-90 days')
                  ), 0))
                )
              FROM price_snapshots ps_latest
              WHERE ps_latest.game_id = ${games.id}
                AND ps_latest.id = (
                  SELECT ps2.id FROM price_snapshots ps2
                  WHERE ps2.game_id = ${games.id}
                  ORDER BY ps2.snapshot_date DESC LIMIT 1
                )
            )`
          : sql<number | null>`NULL`,
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

  // Unfiltered count for "X of Y" display when data completeness filter is active.
  // Uses the pre-data-filter conditions so search/genre/etc. are still applied.
  let totalUnfiltered: number | undefined;
  if (filters.requireCompleteData || filters.hideUnreleased) {
    const unfilteredResult = db
      .select({ count: sql<number>`count(*)` })
      .from(games)
      .innerJoin(userGames, eq(games.id, userGames.gameId))
      .where(and(...conditionsWithoutDataFilters))
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
  const tagsByGame = groupTagsByGame(tagRows);

  // Batch-fetch latest price snapshots
  const pricesByGame = getLatestPriceSnapshots(gameIds);

  // Map to EnrichedGame
  const enriched: EnrichedGame[] = results.map((r) => {
    const base = mapBaseEnrichedGame(r, tagsByGame.get(r.id) ?? EMPTY_TAG_BUCKET);
    // List-view-specific fields not carried by the base mapper.
    base.atlHitDate = r.atlHitDate ?? undefined;
    base.belowAvgPercent = r.belowAvgPercent ?? undefined;
    base.dealBadge =
      filters.view === 'new-atls'
        ? ('new-atl' as const)
        : filters.view === 'deepest-discounts'
          ? ('discount' as const)
          : filters.view === 'heating-up'
            ? ('below-avg' as const)
            : undefined;

    const snapshot = pricesByGame.get(r.id);
    if (snapshot) {
      applySnapshotToGame(base, snapshot, {
        reviewScore: r.reviewScore,
        hltbMain: r.hltbMain,
        steamPlaytimeMedian: r.steamPlaytimeMedian,
        playtimeSource: r.playtimeSource,
        personalInterest: r.personalInterest,
      });
    }

    if (r.isOwned) {
      applyValueReceivedToGame(base, r);
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
  const conditions = buildGameFilterConditions(filters, userId);

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
      hltbManual: games.hltbManual,
      steamPlaytimeMedian: games.steamPlaytimeMedian,
      steamPlaytimeSampleSize: games.steamPlaytimeSampleSize,
      steamPlaytimeMissCount: games.steamPlaytimeMissCount,
      hltbMissCount: games.hltbMissCount,
      priceHistoryBackfilledAt: games.priceHistoryBackfilledAt,
      priceHistoryMissCount: games.priceHistoryMissCount,
      isCoop: games.isCoop,
      isMultiplayer: games.isMultiplayer,
      isReleased: games.isReleased,
      isEarlyAccess: games.isEarlyAccess,
      reviewLastUpdated: games.reviewLastUpdated,
      hltbLastUpdated: games.hltbLastUpdated,
      metadataLastUpdated: games.metadataLastUpdated,
      source: games.source,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      isIgnored: userGames.isIgnored,
      wishlistedLocally: userGames.wishlistedLocally,
      autoAlertDisabled: userGames.autoAlertDisabled,
      playtimeMinutes: userGames.playtimeMinutes,
      personalInterest: userGames.personalInterest,
      playtimeSource: userGames.playtimeSource,
      interestRatedAt: userGames.interestRatedAt,
      enjoymentRating: userGames.enjoymentRating,
      lastPlayed: userGames.lastPlayed,
      pricePaid: userGames.pricePaid,
      pricePaidSuggested: userGames.pricePaidSuggested,
      pricePaidSuggestionDismissedAt: userGames.pricePaidSuggestionDismissedAt,
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

  const bucket = groupTags(tagRows);

  // Fetch latest price snapshot
  const pricesByGame = getLatestPriceSnapshots([gameId]);
  const snapshot = pricesByGame.get(gameId);

  const game = mapBaseEnrichedGame(row, bucket);
  // Detail-view-specific fields not carried by the base mapper.
  game.description = row.description ?? undefined;
  game.hltbManual = row.hltbManual ?? undefined;
  game.hltbMissCount = row.hltbMissCount ?? undefined;
  game.steamPlaytimeMissCount = row.steamPlaytimeMissCount ?? undefined;
  game.priceHistoryBackfilledAt = row.priceHistoryBackfilledAt?.toISOString() ?? undefined;
  game.priceHistoryMissCount = row.priceHistoryMissCount ?? 0;

  if (snapshot) {
    applySnapshotToGame(game, snapshot, {
      reviewScore: row.reviewScore,
      hltbMain: row.hltbMain,
      steamPlaytimeMedian: row.steamPlaytimeMedian,
      playtimeSource: row.playtimeSource,
      personalInterest: row.personalInterest,
    });
  }

  if (row.isOwned) {
    applyValueReceivedToGame(game, row);
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
    .where(and(
      eq(userGames.userId, userId),
      eq(userGames.isWishlisted, true),
      sql`${userGames.wishlistRemovedAt} IS NULL`
    ))
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

/**
 * Count of games the user has any relationship with (owned, wishlisted, or
 * watchlisted). Used by the onboarding checklist + drain orchestrator to
 * pick the "Full" mode estimate.
 */
export function getUserGameCount(userId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(
      and(
        eq(userGames.userId, userId),
        or(
          eq(userGames.isOwned, true),
          and(eq(userGames.isWishlisted, true), sql`${userGames.wishlistRemovedAt} IS NULL`),
          eq(userGames.isWatchlisted, true),
        ),
      ),
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Number of games the user has explicitly rated (interestRatedAt is set).
 * `personal_interest` defaults to 3 for every row, so the rated-vs-untriaged
 * split has to lean on the rated-at timestamp.
 */
export function getRatedGameCount(userId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(
      and(
        eq(userGames.userId, userId),
        sql`${userGames.interestRatedAt} IS NOT NULL`,
      ),
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Owned games the user hasn't explicitly rated yet. Drives the triage nudge
 * (Phase 3) and the "triage your library" checklist item.
 */
export function getUntriagedGameCount(userId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(userGames)
    .where(
      and(
        eq(userGames.userId, userId),
        eq(userGames.isOwned, true),
        sql`${userGames.interestRatedAt} IS NULL`,
      ),
    )
    .get();
  return row?.count ?? 0;
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
  status: 'success' | 'partial' | 'error',
  itemsProcessed: number,
  errorMessage?: string,
  itemsAttempted?: number,
  itemsFailed?: number,
  apiCalls?: number,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(syncLog)
    .set({
      status,
      itemsProcessed,
      ...(itemsAttempted !== undefined && { itemsAttempted }),
      ...(itemsFailed !== undefined && { itemsFailed }),
      ...(apiCalls !== undefined && { apiCalls }),
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
    .where(inArray(syncLog.status, ['success', 'partial']))
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

export function getRecentSyncStats(source: string, limit: number = 5) {
  const db = getDb();
  return db
    .select({
      id: syncLog.id,
      source: syncLog.source,
      status: syncLog.status,
      itemsProcessed: syncLog.itemsProcessed,
      itemsAttempted: syncLog.itemsAttempted,
      itemsFailed: syncLog.itemsFailed,
      apiCalls: syncLog.apiCalls,
      startedAt: syncLog.startedAt,
      completedAt: syncLog.completedAt,
    })
    .from(syncLog)
    .where(eq(syncLog.source, source))
    .orderBy(desc(syncLog.startedAt))
    .limit(limit)
    .all();
}

export function getSyncLogsSince(source: string, sinceDate: string) {
  const db = getDb();
  return db
    .select({
      id: syncLog.id,
      source: syncLog.source,
      status: syncLog.status,
      itemsProcessed: syncLog.itemsProcessed,
      itemsAttempted: syncLog.itemsAttempted,
      itemsFailed: syncLog.itemsFailed,
      apiCalls: syncLog.apiCalls,
      startedAt: syncLog.startedAt,
      completedAt: syncLog.completedAt,
    })
    .from(syncLog)
    .where(and(eq(syncLog.source, source), sql`${syncLog.startedAt} >= ${sinceDate}`))
    .orderBy(desc(syncLog.startedAt))
    .all();
}

/**
 * Full sync_log rows (including errorMessage) for one source, most recent first.
 * Used by the System Settings drill-down endpoint.
 */
export function getSyncLogsForSource(source: string, limit: number = 50) {
  const db = getDb();
  return db
    .select()
    .from(syncLog)
    .where(eq(syncLog.source, source))
    .orderBy(desc(syncLog.startedAt))
    .limit(limit)
    .all();
}

/**
 * Sum of `api_calls` across all sync_log rows for a set of sources since `sinceDate`.
 * NULL `api_calls` values count as zero (older rows, untracked sync types).
 */
export function sumApiCallsBySourcesSince(sources: string[], sinceDate: string): number {
  if (sources.length === 0) return 0;
  const db = getDb();
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${syncLog.apiCalls}), 0)` })
    .from(syncLog)
    .where(and(inArray(syncLog.source, sources), sql`${syncLog.startedAt} >= ${sinceDate}`))
    .get();
  return row?.total ?? 0;
}

/**
 * Per-day rollup of sync results for one source.
 * Returns one row per UTC day in the window, sorted ascending.
 */
export function getDailySyncRollup(
  source: string,
  sinceDate: string,
): Array<{
  day: string;
  total: number;
  succeeded: number;
  partial: number;
  errored: number;
  itemsProcessed: number;
  itemsAttempted: number;
  itemsFailed: number;
  apiCalls: number;
}> {
  const db = getDb();
  return db
    .select({
      day: sql<string>`substr(${syncLog.startedAt}, 1, 10)`,
      total: sql<number>`COUNT(*)`,
      succeeded: sql<number>`SUM(CASE WHEN ${syncLog.status} = 'success' THEN 1 ELSE 0 END)`,
      partial: sql<number>`SUM(CASE WHEN ${syncLog.status} = 'partial' THEN 1 ELSE 0 END)`,
      errored: sql<number>`SUM(CASE WHEN ${syncLog.status} = 'error' THEN 1 ELSE 0 END)`,
      itemsProcessed: sql<number>`COALESCE(SUM(${syncLog.itemsProcessed}), 0)`,
      itemsAttempted: sql<number>`COALESCE(SUM(${syncLog.itemsAttempted}), 0)`,
      itemsFailed: sql<number>`COALESCE(SUM(${syncLog.itemsFailed}), 0)`,
      apiCalls: sql<number>`COALESCE(SUM(${syncLog.apiCalls}), 0)`,
    })
    .from(syncLog)
    .where(and(eq(syncLog.source, source), sql`${syncLog.startedAt} >= ${sinceDate}`))
    .groupBy(sql`substr(${syncLog.startedAt}, 1, 10)`)
    .orderBy(sql`substr(${syncLog.startedAt}, 1, 10) ASC`)
    .all();
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

export function getGamesForPriceSync(userId: string): Array<{
  id: number;
  steamAppId: number;
  title: string;
  itadGameId: string | null;
  reviewScore: number | null;
  hltbMain: number | null;
  personalInterest: number | null;
}> {
  const db = getDb();

  return db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      itadGameId: games.itadGameId,
      reviewScore: games.reviewScore,
      hltbMain: games.hltbMain,
      personalInterest: userGames.personalInterest,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        sql`(${userGames.isWishlisted} = 1 OR ${userGames.isWatchlisted} = 1)`,
        // Skip games we know are unreleased — ITAD reports preorder MSRP / store
        // sentinels (e.g. $999) for these. Unknown release status (NULL) is kept
        // so newly-tracked games still get priced until release_check resolves them.
        sql`(${games.isReleased} IS NULL OR ${games.isReleased} = 1)`
      )
    )
    .all();
}

/**
 * Count of games the user currently owns. Used by library sync to distinguish
 * the very first import (0 prior owned) from steady-state incremental adds — the
 * net-new price-fetch lane only fires "going forward from account creation", so
 * the onboarding drain (which primes the whole library) owns the initial import.
 */
export function countOwnedGames(userId: string): number {
  const db = getDb();
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(userGames)
    .where(and(eq(userGames.userId, userId), eq(userGames.isOwned, true)))
    .get();
  return row?.n ?? 0;
}

/**
 * Fetch the price-sync inputs for a specific set of games (by id), regardless of
 * wishlist/watchlist status. Powers the net-new owned-add price fetch (part 2):
 * a straight purchase that was never wishlisted has no snapshot yet, so we
 * resolve its ITAD id + fetch one overview so the price-paid nudge has data.
 * Mirrors getGamesForPriceSync's shape, minus the wishlist/watchlist filter.
 */
export function getGamesByIdsForPriceFetch(gameIds: number[]): Array<{
  id: number;
  steamAppId: number;
  title: string;
  itadGameId: string | null;
  reviewScore: number | null;
  hltbMain: number | null;
  personalInterest: number | null;
}> {
  if (gameIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      itadGameId: games.itadGameId,
      reviewScore: games.reviewScore,
      hltbMain: games.hltbMain,
      // personalInterest isn't user-scoped here (single-user price fetch); the
      // net-new add path always uses the sync's effective user, so any row wins.
      personalInterest: userGames.personalInterest,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        inArray(games.id, gameIds),
        sql`(${games.isReleased} IS NULL OR ${games.isReleased} = 1)`,
      ),
    )
    .all();
}

export function bulkUpdateGameItadIds(updates: Array<{ steamAppId: number; itadGameId: string }>): void {
  const db = getDb();
  const now = new Date().toISOString();
  const sqlite = db.$client;

  const runUpdates = sqlite.transaction(() => {
    for (const { steamAppId, itadGameId } of updates) {
      db.update(games)
        .set({ itadGameId, updatedAt: now })
        .where(eq(games.steamAppId, steamAppId))
        .run();
    }
  });
  runUpdates();
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

  // A new review % shifts the review component of the deal score, so refresh the
  // stored value the sort reads to match the live-recomputed badge.
  if (data.reviewScore !== undefined) recomputeLatestSnapshotDealScore(gameId);
}

// Tags that indicate software, not games — skip HLTB lookup entirely
const SOFTWARE_TAGS = ['Software', 'Utilities', 'Game Development', 'Video Production', 'Photo Editing', 'Audio Production', 'Design & Illustration', 'Accounting', 'Web Publishing'];

// After this many consecutive misses, stop automatic retries (DLCs, soundtracks, etc. that
// will never have an HLTB entry). Games can still be matched via manual search on the detail page.
const HLTB_GIVE_UP_MISSES = 8;

export function getGamesForHltbSync(): Array<{ id: number; title: string; hltbMissCount: number | null }> {
  const db = getDb();
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 90); // 90 days

  return db
    .select({
      id: games.id,
      title: games.title,
      hltbMissCount: games.hltbMissCount,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        or(
          isNull(games.hltbManual),
          eq(games.hltbManual, false),
        ),
        // Exclude software/utilities (not games, will never have HLTB data)
        sql`${games.id} NOT IN (
          SELECT gt.game_id FROM game_tags gt
          INNER JOIN tags t ON gt.tag_id = t.id
          WHERE t.name IN (${sql.join(SOFTWARE_TAGS.map(t => sql`${t}`), sql`, `)})
        )`,
        // Only sync games the user has a relationship with (excludes source='lookup' orphans)
        or(
          eq(userGames.isOwned, true),
          eq(userGames.isWishlisted, true),
          eq(userGames.isWatchlisted, true),
        ),
        or(
          // Never checked
          isNull(games.hltbLastUpdated),
          // Stale (has HLTB data but >90 days old)
          lt(games.hltbLastUpdated, staleThreshold.toISOString()),
          // No match — retry with exponential backoff:
          //   miss 0-2: 7 days, miss 3-4: 30 days, miss 5-7: 90 days, 8+: give up
          and(
            isNull(games.hltbId),
            sql`COALESCE(${games.hltbMissCount}, 0) < ${HLTB_GIVE_UP_MISSES}`,
            sql`${games.hltbLastUpdated} < datetime('now', '-' || CASE
              WHEN COALESCE(${games.hltbMissCount}, 0) <= 2 THEN '7'
              WHEN COALESCE(${games.hltbMissCount}, 0) <= 4 THEN '30'
              ELSE '90'
            END || ' days')`
          )
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
  },
  missed?: boolean,
): void {
  const db = getDb();
  db.update(games)
    .set({
      hltbId: data.hltbId,
      hltbMain: data.hltbMain,
      hltbMainExtra: data.hltbMainExtra,
      hltbCompletionist: data.hltbCompletionist,
      hltbLastUpdated: new Date().toISOString(),
      // Reset miss count on match, increment on miss
      ...(missed
        ? { hltbMissCount: sql`COALESCE(${games.hltbMissCount}, 0) + 1` }
        : { hltbMissCount: 0 }),
    })
    .where(eq(games.id, gameId))
    .run();

  // A match changes HLTB hours → the $/hr value component, so refresh the stored
  // deal score the sort reads to match the live-recomputed badge. A miss leaves
  // HLTB unchanged, so nothing to recompute.
  if (!missed) recomputeLatestSnapshotDealScore(gameId);
}

export function updateManualHltbData(
  gameId: number,
  data: {
    hltbMain?: number | null;
    hltbMainExtra?: number | null;
    hltbCompletionist?: number | null;
  }
): void {
  const db = getDb();
  const isClearing = data.hltbMain === null && data.hltbMainExtra === null && data.hltbCompletionist === null;

  db.update(games)
    .set({
      hltbMain: data.hltbMain ?? undefined,
      hltbMainExtra: data.hltbMainExtra ?? undefined,
      hltbCompletionist: data.hltbCompletionist ?? undefined,
      hltbManual: !isClearing,
      hltbLastUpdated: isClearing ? null : new Date().toISOString(),
    })
    .where(eq(games.id, gameId))
    .run();

  // Manual HLTB edit changes the value component → keep the stored deal score
  // (the sort key) in sync with the live badge.
  recomputeLatestSnapshotDealScore(gameId);
}

export function updateGameLastViewedAt(gameId: number): void {
  const db = getDb();
  db.update(games)
    .set({ lastViewedAt: new Date() })
    .where(and(eq(games.id, gameId), eq(games.source, 'lookup')))
    .run();
}

export function setHltbExcluded(gameId: number, excluded: boolean): void {
  const db = getDb();
  db.update(games)
    .set({
      hltbManual: excluded,
      // When excluding: mark as checked so it doesn't show as "never checked"
      // When re-including: clear so sync picks it up next run
      hltbLastUpdated: excluded ? new Date().toISOString() : null,
      hltbMissCount: 0,
    })
    .where(eq(games.id, gameId))
    .run();
}

/**
 * Games eligible for a Steam-review playtime backfill: currently wishlisted (and
 * not locally removed), no median stored yet, and under the give-up miss cap.
 * Scoped to the wishlist (not the whole library) to keep Steam volume bounded —
 * the wishlist is where playtime divergence informs a buy/wait/drop decision.
 * Ordered by reviewCount desc so the most-reviewed (most reliable) games sample first.
 * Mirrors {@link getGamesForHltbSync}.
 */
export function getGamesForSteamPlaytimeSync(): Array<{ id: number; title: string; steamAppId: number }> {
  const db = getDb();
  return db
    .selectDistinct({
      id: games.id,
      title: games.title,
      steamAppId: games.steamAppId,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.isWishlisted, true),
        isNull(userGames.wishlistRemovedAt),
        isNull(games.steamPlaytimeMedian),
        sql`COALESCE(${games.steamPlaytimeMissCount}, 0) < ${STEAM_PLAYTIME_GIVE_UP_MISSES}`,
      )
    )
    .orderBy(desc(games.reviewCount))
    .all();
}

/**
 * Persist the Steam-review playtime median for a game. On a usable sample, store
 * the median (hours) + sample size + timestamp and reset the miss counter; on a
 * miss (no/too-small sample), increment the counter and leave the value alone.
 * Mirrors {@link updateGameHltbData}.
 */
export function updateGameSteamPlaytime(
  gameId: number,
  data: { medianHours: number; sampleSize: number } | null,
): void {
  const db = getDb();
  const missed = data === null;

  db.update(games)
    .set({
      steamPlaytimeUpdatedAt: new Date().toISOString(),
      ...(missed
        ? { steamPlaytimeMissCount: sql`COALESCE(${games.steamPlaytimeMissCount}, 0) + 1` }
        : {
            steamPlaytimeMedian: data.medianHours,
            steamPlaytimeSampleSize: data.sampleSize,
            steamPlaytimeMissCount: 0,
          }),
    })
    .where(eq(games.id, gameId))
    .run();

  // A new median can change the $/hr value component for games whose source is
  // (or falls back to) steam_reviews, so refresh the stored deal score. A miss
  // leaves the value unchanged.
  if (!missed) recomputeLatestSnapshotDealScore(gameId);
}

/**
 * Set which playtime basis ('hltb' | 'steam_reviews') feeds $/hour scoring for a
 * game, then refresh the stored deal score so the sort key tracks the badge —
 * exactly as {@link updateManualHltbData} does for a manual HLTB edit.
 */
export function setPlaytimeSource(gameId: number, source: PlaytimeSource, userId: string): boolean {
  const db = getDb();
  const result = db
    .update(userGames)
    .set({ playtimeSource: source })
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .run();

  // No user_games row yet (e.g. a looked-up game) → nothing to set.
  if (result.changes === 0) return false;

  recomputeLatestSnapshotDealScore(gameId);
  return true;
}

// After this many consecutive failed backfill attempts, stop retrying so we
// don't pound ITAD for games whose itadGameId is permanently bad.
export const PRICE_HISTORY_GIVE_UP_MISSES = 3;

export function getGamesForPriceHistoryBackfill(
  limit: number,
  userId?: string,
): Array<{ id: number; title: string; itadGameId: string }> {
  const db = getDb();
  return db
    .selectDistinct({
      id: games.id,
      title: games.title,
      itadGameId: games.itadGameId,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        isNull(games.priceHistoryBackfilledAt),
        sql`${games.itadGameId} IS NOT NULL`,
        sql`COALESCE(${games.priceHistoryMissCount}, 0) < ${PRICE_HISTORY_GIVE_UP_MISSES}`,
        or(
          eq(userGames.isOwned, true),
          eq(userGames.isWishlisted, true),
          eq(userGames.isWatchlisted, true),
        ),
        // Scope to a single user when provided — required for multi-user
        // safety so an authenticated user can't trigger backfill across
        // every other user's library.
        ...(userId !== undefined ? [eq(userGames.userId, userId)] : []),
      ),
    )
    // Process highest-interest games first so the chart fills in for
    // the games the user is most likely to look at
    .orderBy(desc(games.reviewCount))
    .limit(limit)
    .all() as Array<{ id: number; title: string; itadGameId: string }>;
}

export function markPriceHistoryBackfilled(gameId: number): void {
  const db = getDb();
  db.update(games)
    .set({
      priceHistoryBackfilledAt: new Date(),
      priceHistoryMissCount: 0,
    })
    .where(eq(games.id, gameId))
    .run();
}

export function incrementPriceHistoryMissCount(gameId: number): void {
  // Single atomic UPDATE: increment the miss count and, if that pushes the
  // game over the give-up threshold, stamp `price_history_backfilled_at` in
  // the same statement so the candidate query stops picking it up. Doing
  // both in one statement avoids a race when two callers (cron + manual
  // trigger) operate on the same game.
  const db = getDb();
  const nowMs = Date.now();
  db.run(sql`
    UPDATE games
    SET
      price_history_miss_count = COALESCE(price_history_miss_count, 0) + 1,
      price_history_backfilled_at = CASE
        WHEN COALESCE(price_history_miss_count, 0) + 1 >= ${PRICE_HISTORY_GIVE_UP_MISSES}
          AND price_history_backfilled_at IS NULL
        THEN ${nowMs}
        ELSE price_history_backfilled_at
      END
    WHERE id = ${gameId}
  `);
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
    .onConflictDoNothing({
      target: [priceSnapshots.gameId, priceSnapshots.store, priceSnapshots.snapshotDate],
    })
    .run();
}

export interface PriceSnapshotInsert {
  gameId: number;
  store: string;
  priceCurrent: number;
  priceRegular: number;
  discountPercent: number;
  currency?: string;
  snapshotDate: string;
}

/**
 * Bulk-insert historical price snapshots, ignoring rows that would collide
 * with the (gameId, store, snapshotDate) unique index. Returns the count of
 * rows actually inserted vs. skipped.
 */
export function bulkInsertPriceSnapshots(
  rows: PriceSnapshotInsert[]
): { inserted: number; skipped: number } {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const db = getDb();

  let inserted = 0;
  // Chunk to keep SQLite happy with very large arrays (e.g. multi-store
  // multi-year history can run into the thousands per game).
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = db
      .insert(priceSnapshots)
      .values(
        chunk.map((r) => ({
          gameId: r.gameId,
          store: r.store,
          priceCurrent: r.priceCurrent,
          priceRegular: r.priceRegular,
          discountPercent: r.discountPercent,
          currency: r.currency ?? 'USD',
          snapshotDate: r.snapshotDate,
        }))
      )
      .onConflictDoNothing({
        target: [priceSnapshots.gameId, priceSnapshots.store, priceSnapshots.snapshotDate],
      })
      .run();
    inserted += result.changes;
  }

  return { inserted, skipped: rows.length - inserted };
}

export function getGameItadInfo(
  gameId: number
): { id: number; itadGameId: string | null; title: string } | null {
  const db = getDb();
  const row = db
    .select({ id: games.id, itadGameId: games.itadGameId, title: games.title })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  return row ?? null;
}

/** Cheap existence check for a game row (used to keep 404 semantics on PATCH). */
export function gameExists(gameId: number): boolean {
  const db = getDb();
  return (
    db.select({ id: games.id }).from(games).where(eq(games.id, gameId)).get() != null
  );
}

/** Game fields needed to drive the on-demand price-history backfill (ensure-history route). */
export function getGameBackfillState(gameId: number): {
  id: number;
  steamAppId: number;
  itadGameId: string | null;
  priceHistoryBackfilledAt: Date | null;
  priceHistoryMissCount: number;
} | null {
  const db = getDb();
  const row = db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      itadGameId: games.itadGameId,
      priceHistoryBackfilledAt: games.priceHistoryBackfilledAt,
      priceHistoryMissCount: games.priceHistoryMissCount,
    })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  if (!row) return null;
  return { ...row, priceHistoryMissCount: row.priceHistoryMissCount ?? 0 };
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

/**
 * Prune old price snapshots, keeping only the most recent N days.
 * Returns the number of rows deleted.
 */
export function pruneOldPriceSnapshots(retainDays: number = 180): number {
  const db = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retainDays);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const result = db
    .delete(priceSnapshots)
    .where(sql`${priceSnapshots.snapshotDate} < ${cutoff}`)
    .run();

  return result.changes;
}

// ============================================
// Playtime Snapshots — time-series + realized-value derivations
// ============================================
// Steam library-sync OVERWRITES user_games.playtimeMinutes each run, destroying
// the prior total. These rows preserve the pre-overwrite series so Hoard can
// measure realized value over time the way price_snapshots preserve price
// history. Written per game per sync (src/lib/sync/library.ts), deduped per
// (game, user, day), pruned on the same 180-day window as price snapshots.

/** YYYY-MM-DD for `days` ago (UTC), matching the snapshotDate format. */
function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Record a playtime data point for a game. Called during library-sync BEFORE
 * upsertUserGame overwrites the stored total, so the accumulating series is the
 * history the old code destroyed. Deduped on (gameId, userId, snapshotDate): a
 * second sync the same day is a no-op (first-write-wins), mirroring
 * insertPriceSnapshot's onConflictDoNothing.
 */
export function insertPlaytimeSnapshot(data: {
  gameId: number;
  userId: string;
  playtimeMinutes: number;
  recentMinutes?: number;
  lastPlayed?: string;
  snapshotDate?: string;
}): void {
  const db = getDb();
  const snapshotDate = data.snapshotDate ?? new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  db.insert(playtimeSnapshots)
    .values({
      gameId: data.gameId,
      userId: data.userId,
      playtimeMinutes: data.playtimeMinutes,
      recentMinutes: data.recentMinutes ?? 0,
      lastPlayed: data.lastPlayed,
      snapshotDate,
    })
    .onConflictDoNothing({
      target: [playtimeSnapshots.gameId, playtimeSnapshots.userId, playtimeSnapshots.snapshotDate],
    })
    .run();
}

export interface PlaytimeSnapshotRow {
  snapshotDate: string;
  playtimeMinutes: number;
  recentMinutes: number;
  lastPlayed: string | null;
}

/**
 * Full playtime series for a game (oldest → newest), capped at the `limit` most
 * recent points. Mirrors getPriceHistory.
 */
export function getPlaytimeHistory(gameId: number, userId: string, limit = 180): PlaytimeSnapshotRow[] {
  const db = getDb();
  const rows = db
    .select({
      snapshotDate: playtimeSnapshots.snapshotDate,
      playtimeMinutes: playtimeSnapshots.playtimeMinutes,
      recentMinutes: playtimeSnapshots.recentMinutes,
      lastPlayed: playtimeSnapshots.lastPlayed,
    })
    .from(playtimeSnapshots)
    .where(and(eq(playtimeSnapshots.gameId, gameId), eq(playtimeSnapshots.userId, userId)))
    .orderBy(desc(playtimeSnapshots.snapshotDate))
    .limit(limit)
    .all();

  return rows
    .map((r) => ({
      snapshotDate: r.snapshotDate,
      playtimeMinutes: r.playtimeMinutes,
      recentMinutes: r.recentMinutes ?? 0,
      lastPlayed: r.lastPlayed,
    }))
    .reverse(); // oldest → newest
}

export interface PlaytimeWindow {
  baselineMinutes: number; // cumulative total as the window opened
  latestMinutes: number; // most recent cumulative total
  gainedMinutes: number; // max(0, latest - baseline)
}

/**
 * How much playtime a game gained since `sinceDate` (YYYY-MM-DD).
 * Baseline = the most recent snapshot on/before the cutoff (the total as the
 * window opened); if none exists, the earliest snapshot after it (best
 * available — we can't know playtime before our first sample). Gain is clamped
 * ≥0 to absorb Steam refunds / playtime resets. Returns null when the game has
 * no snapshots at all.
 */
export function getPlaytimeWindow(gameId: number, userId: string, sinceDate: string): PlaytimeWindow | null {
  const db = getDb();

  const latest = db
    .select({ playtimeMinutes: playtimeSnapshots.playtimeMinutes })
    .from(playtimeSnapshots)
    .where(and(eq(playtimeSnapshots.gameId, gameId), eq(playtimeSnapshots.userId, userId)))
    .orderBy(desc(playtimeSnapshots.snapshotDate))
    .limit(1)
    .get();

  if (!latest) return null;

  // Most recent snapshot at/before the window start = the total as the window opened.
  let baselineRow = db
    .select({ playtimeMinutes: playtimeSnapshots.playtimeMinutes })
    .from(playtimeSnapshots)
    .where(
      and(
        eq(playtimeSnapshots.gameId, gameId),
        eq(playtimeSnapshots.userId, userId),
        sql`${playtimeSnapshots.snapshotDate} <= ${sinceDate}`,
      ),
    )
    .orderBy(desc(playtimeSnapshots.snapshotDate))
    .limit(1)
    .get();

  // No pre-window sample: fall back to the earliest sample we do have. Gain is
  // then measured from first observation, never from an assumed zero.
  if (!baselineRow) {
    baselineRow = db
      .select({ playtimeMinutes: playtimeSnapshots.playtimeMinutes })
      .from(playtimeSnapshots)
      .where(and(eq(playtimeSnapshots.gameId, gameId), eq(playtimeSnapshots.userId, userId)))
      .orderBy(asc(playtimeSnapshots.snapshotDate))
      .limit(1)
      .get();
  }

  const baselineMinutes = baselineRow?.playtimeMinutes ?? latest.playtimeMinutes;
  const gainedMinutes = Math.max(0, latest.playtimeMinutes - baselineMinutes);
  return { baselineMinutes, latestMinutes: latest.playtimeMinutes, gainedMinutes };
}

export type PlaytimeMomentum = 'playing' | 'cooling' | 'dormant' | 'untouched';

/**
 * Classify a game's momentum from playtime deltas. Maps the audit's
 * playing/dormant/dropped-off onto four honest buckets:
 *   playing   — gained time this week, or Steam reports 2-week activity
 *   cooling   — no gain this week but gained within the month
 *   dormant   — meaningfully played before, but quiet for a month (the
 *               backlog-staleness / "dropped-off" signal)
 *   untouched — owned but effectively never played
 * Pure and DB-free so it's unit-testable in isolation.
 */
export function classifyPlaytimeMomentum(input: {
  gainedThisWeek: number; // minutes
  gainedThisMonth: number; // minutes
  totalMinutes: number;
  recentMinutes: number; // Steam rolling 2-week
}): PlaytimeMomentum {
  const MEANINGFUL_MINUTES = 60; // < 1h ever ≈ never really started
  if (input.gainedThisWeek > 0 || input.recentMinutes > 0) return 'playing';
  if (input.gainedThisMonth > 0) return 'cooling';
  if (input.totalMinutes >= MEANINGFUL_MINUTES) return 'dormant';
  return 'untouched';
}

export interface PlaytimeValueAccrual {
  pricePaid: number;
  dollarsPerHourNow: number;
  dollarsPerHourMonthAgo: number | null; // null when no hours a month ago
  improved: boolean; // $/hr now < $/hr a month ago → value accruing
}

export interface GamePlaytimeInsight {
  gameId: number;
  totalMinutes: number;
  hoursThisWeek: number; // hours gained, rounded to 0.1
  hoursThisMonth: number;
  momentum: PlaytimeMomentum;
  valueAccrual: PlaytimeValueAccrual | null; // null unless pricePaid known & played
}

const PLAYTIME_WEEK_DAYS = 7;
const PLAYTIME_MONTH_DAYS = 30;

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * Per-game realized-value derivations from the snapshot series: hours gained
 * this week/month, momentum, and $/hr value-accrual (when the user has entered
 * pricePaid). Surface-ready for a detail-page card; the consuming UI is a later
 * item. Returns null when the game has no snapshots yet.
 */
export function getGamePlaytimeInsight(gameId: number, userId: string): GamePlaytimeInsight | null {
  const db = getDb();
  const weekWindow = getPlaytimeWindow(gameId, userId, daysAgoDate(PLAYTIME_WEEK_DAYS));
  if (!weekWindow) return null;
  const monthWindow = getPlaytimeWindow(gameId, userId, daysAgoDate(PLAYTIME_MONTH_DAYS));

  const latest = db
    .select({
      playtimeMinutes: playtimeSnapshots.playtimeMinutes,
      recentMinutes: playtimeSnapshots.recentMinutes,
    })
    .from(playtimeSnapshots)
    .where(and(eq(playtimeSnapshots.gameId, gameId), eq(playtimeSnapshots.userId, userId)))
    .orderBy(desc(playtimeSnapshots.snapshotDate))
    .limit(1)
    .get();

  const totalMinutes = latest?.playtimeMinutes ?? weekWindow.latestMinutes;
  const recentMinutes = latest?.recentMinutes ?? 0;
  const gainedThisWeek = weekWindow.gainedMinutes;
  const gainedThisMonth = monthWindow?.gainedMinutes ?? gainedThisWeek;

  const momentum = classifyPlaytimeMomentum({
    gainedThisWeek,
    gainedThisMonth,
    totalMinutes,
    recentMinutes,
  });

  // Value accrual: realized $/hr now vs a month ago. Needs a user-entered price
  // and non-zero hours. As hours grow, $/hr falls — that fall is the value accruing.
  let valueAccrual: PlaytimeValueAccrual | null = null;
  const ug = db
    .select({ pricePaid: userGames.pricePaid })
    .from(userGames)
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .get();
  const pricePaid = ug?.pricePaid ?? null;
  if (pricePaid != null && pricePaid > 0 && totalMinutes > 0) {
    const dollarsPerHourNow = pricePaid / (totalMinutes / 60);
    const monthAgoMinutes = monthWindow?.baselineMinutes ?? totalMinutes;
    const dollarsPerHourMonthAgo = monthAgoMinutes > 0 ? pricePaid / (monthAgoMinutes / 60) : null;
    valueAccrual = {
      pricePaid,
      dollarsPerHourNow: Math.round(dollarsPerHourNow * 100) / 100,
      dollarsPerHourMonthAgo:
        dollarsPerHourMonthAgo != null ? Math.round(dollarsPerHourMonthAgo * 100) / 100 : null,
      improved: dollarsPerHourMonthAgo != null && dollarsPerHourNow < dollarsPerHourMonthAgo,
    };
  }

  return {
    gameId,
    totalMinutes,
    hoursThisWeek: roundHours(gainedThisWeek),
    hoursThisMonth: roundHours(gainedThisMonth),
    momentum,
    valueAccrual,
  };
}

export interface PlaytimeRecapGainer {
  gameId: number;
  title: string;
  hoursThisWeek: number;
}

export interface LibraryPlaytimeRecap {
  hoursThisWeek: number;
  hoursThisMonth: number;
  gamesPlayedThisWeek: number;
  topGainers: PlaytimeRecapGainer[]; // most hours gained this week, desc
}

/**
 * Small dashboard rollup over the whole library: total hours gained this
 * week/month, how many games saw play this week, and the week's top gainers.
 * Only games with a snapshot inside the month window are candidates (a game with
 * no recent sample gained nothing to report). Iterates per candidate game at
 * single-user scale — deliberately readable over a windowed mega-query, matching
 * the repo's single-user performance posture (plans/30-performance).
 */
export function getLibraryPlaytimeRecap(
  userId: string,
  opts: { weekDays?: number; monthDays?: number; topN?: number } = {},
): LibraryPlaytimeRecap {
  const db = getDb();
  const weekDays = opts.weekDays ?? PLAYTIME_WEEK_DAYS;
  const monthDays = opts.monthDays ?? PLAYTIME_MONTH_DAYS;
  const topN = opts.topN ?? 5;
  const weekCutoff = daysAgoDate(weekDays);
  const monthCutoff = daysAgoDate(monthDays);

  // Candidate games: any snapshot inside the month window (indexed range scan).
  const candidates = db
    .selectDistinct({ gameId: playtimeSnapshots.gameId })
    .from(playtimeSnapshots)
    .where(
      and(
        eq(playtimeSnapshots.userId, userId),
        sql`${playtimeSnapshots.snapshotDate} >= ${monthCutoff}`,
      ),
    )
    .all();

  let weekMinutes = 0;
  let monthMinutes = 0;
  let gamesPlayedThisWeek = 0;
  const gainers: { gameId: number; weekMinutes: number }[] = [];

  for (const { gameId } of candidates) {
    const week = getPlaytimeWindow(gameId, userId, weekCutoff);
    const month = getPlaytimeWindow(gameId, userId, monthCutoff);
    const wk = week?.gainedMinutes ?? 0;
    const mo = month?.gainedMinutes ?? 0;
    weekMinutes += wk;
    monthMinutes += mo;
    if (wk > 0) {
      gamesPlayedThisWeek++;
      gainers.push({ gameId, weekMinutes: wk });
    }
  }

  gainers.sort((a, b) => b.weekMinutes - a.weekMinutes);
  const top = gainers.slice(0, topN);
  const titlesById = new Map<number, string>();
  if (top.length > 0) {
    const rows = db
      .select({ id: games.id, title: games.title })
      .from(games)
      .where(
        inArray(
          games.id,
          top.map((g) => g.gameId),
        ),
      )
      .all();
    for (const r of rows) titlesById.set(r.id, r.title);
  }

  return {
    hoursThisWeek: roundHours(weekMinutes),
    hoursThisMonth: roundHours(monthMinutes),
    gamesPlayedThisWeek,
    topGainers: top.map((g) => ({
      gameId: g.gameId,
      title: titlesById.get(g.gameId) ?? 'Unknown',
      hoursThisWeek: roundHours(g.weekMinutes),
    })),
  };
}

/**
 * Prune old playtime snapshots, keeping only the most recent N days. Mirrors
 * pruneOldPriceSnapshots (same 180-day default, same monthly prune task).
 * Returns the number of rows deleted.
 */
export function pruneOldPlaytimeSnapshots(retainDays = 180): number {
  const db = getDb();
  const cutoff = daysAgoDate(retainDays);
  const result = db
    .delete(playtimeSnapshots)
    .where(sql`${playtimeSnapshots.snapshotDate} < ${cutoff}`)
    .run();
  return result.changes;
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
    isWishlisted: boolean;
    wishlistedLocally: boolean;
    autoAlertDisabled: boolean;
    pricePaid: number | null;
    enjoymentRating: number | null;
    /** Action flag (not a column): "Not now" on a price-paid suggestion → stamp dismissed. */
    dismissPriceSuggestion: boolean;
  }>,
  userId: string
): boolean {
  const db = getDb();
  const now = new Date().toISOString();

  // Derive wishlistRemovedAt stamp from isWishlisted changes
  const wishlistRemovedAt =
    updates.isWishlisted === false
      ? new Date().toISOString()
      : updates.isWishlisted === true
        ? null
        : undefined;

  // Only spread known user_games columns to prevent unexpected fields leaking through
  const { personalInterest, notes, isWatchlisted, isIgnored, priceThreshold, isWishlisted, wishlistedLocally, autoAlertDisabled, pricePaid, enjoymentRating, dismissPriceSuggestion } = updates;

  const result = db
    .update(userGames)
    .set({
      ...(personalInterest !== undefined && { personalInterest }),
      ...(notes !== undefined && { notes }),
      ...(isWatchlisted !== undefined && { isWatchlisted }),
      ...(isIgnored !== undefined && { isIgnored }),
      ...(priceThreshold !== undefined && { priceThreshold }),
      ...(isWishlisted !== undefined && { isWishlisted }),
      ...(wishlistedLocally !== undefined && { wishlistedLocally }),
      ...(autoAlertDisabled !== undefined && { autoAlertDisabled }),
      // Stamp pricePaidAt when a price is recorded; clear it when the price is cleared (null).
      // Confirming/entering a real price also consumes any pending suggestion.
      ...(pricePaid !== undefined && {
        pricePaid,
        pricePaidAt: pricePaid === null ? null : now,
        ...(pricePaid !== null && { pricePaidSuggested: null }),
      }),
      // Stamp enjoymentRatedAt when a rating is recorded; clear it when the rating is cleared (null).
      ...(enjoymentRating !== undefined && {
        enjoymentRating,
        enjoymentRatedAt: enjoymentRating === null ? null : now,
      }),
      // "Not now" on a suggestion — stamp dismissal so it won't re-surface.
      ...(dismissPriceSuggestion === true && { pricePaidSuggestionDismissedAt: now }),
      updatedAt: now,
      // Track when interest was explicitly rated
      ...(personalInterest !== undefined && { interestRatedAt: now }),
      // Auto-stamp removal time when unwishlisting; clear when re-wishlisting
      ...(wishlistRemovedAt !== undefined && { wishlistRemovedAt }),
    })
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .run();

  if (result.changes === 0) return false;

  // Deactivate watchlist and price alert when unwishlisting; clear the
  // Hoard-only flag (it's no longer a wishlist entry of any kind).
  if (updates.isWishlisted === false) {
    db.update(userGames)
      .set({ isWatchlisted: false, wishlistedLocally: false, updatedAt: now })
      .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
      .run();
    const existingAlert = db
      .select({ id: priceAlerts.id })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.gameId, gameId), eq(priceAlerts.userId, userId)))
      .get();
    if (existingAlert) {
      db.update(priceAlerts)
        .set({ isActive: false })
        .where(eq(priceAlerts.id, existingAlert.id))
        .run();
    }
  }

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
// Releases (Upcoming Games)
// ============================================

/**
 * Get unreleased wishlisted games for the Releases page.
 * Only includes games explicitly marked as unreleased by Steam (isReleased = false).
 */
export function getUnreleasedWishlistGames(userId: string): EnrichedGame[] {
  const db = getDb();

  const results = db
    .select({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
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
      hltbManual: games.hltbManual,
      steamPlaytimeMedian: games.steamPlaytimeMedian,
      steamPlaytimeSampleSize: games.steamPlaytimeSampleSize,
      isCoop: games.isCoop,
      isMultiplayer: games.isMultiplayer,
      isReleased: games.isReleased,
      isEarlyAccess: games.isEarlyAccess,
      source: games.source,
      reviewLastUpdated: games.reviewLastUpdated,
      hltbLastUpdated: games.hltbLastUpdated,
      metadataLastUpdated: games.metadataLastUpdated,
      isOwned: userGames.isOwned,
      isWishlisted: userGames.isWishlisted,
      isWatchlisted: userGames.isWatchlisted,
      isIgnored: userGames.isIgnored,
      wishlistedLocally: userGames.wishlistedLocally,
      autoAlertDisabled: userGames.autoAlertDisabled,
      playtimeMinutes: userGames.playtimeMinutes,
      personalInterest: userGames.personalInterest,
      playtimeSource: userGames.playtimeSource,
      lastPlayed: userGames.lastPlayed,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        eq(userGames.isWishlisted, true),
        or(eq(games.isReleased, false), isNull(games.isReleased)),
      )
    )
    .orderBy(asc(games.title))
    .all();

  const gameIds = results.map((r) => r.id);

  // Batch-fetch tags
  const tagRows =
    gameIds.length > 0
      ? db
          .select({ gameId: gameTags.gameId, name: tags.name, type: tags.type })
          .from(gameTags)
          .innerJoin(tags, eq(gameTags.tagId, tags.id))
          .where(inArray(gameTags.gameId, gameIds))
          .all()
      : [];

  const tagsByGame = groupTagsByGame(tagRows);

  return results.map((r) => {
    const game = mapBaseEnrichedGame(r, tagsByGame.get(r.id) ?? EMPTY_TAG_BUCKET);
    game.hltbManual = r.hltbManual ?? undefined;
    return game;
  });
}

/**
 * Lightweight variant of getUnreleasedWishlistGames for callers (e.g. the
 * dashboard's "upcoming releases" card) that only need id/title/releaseDate.
 * Skips the tag join and full EnrichedGame enrichment.
 */
export function getUnreleasedWishlistTitles(
  userId: string,
): { id: number; title: string; releaseDate: string | undefined }[] {
  const db = getDb();
  const rows = db
    .select({
      id: games.id,
      title: games.title,
      releaseDate: games.releaseDate,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        eq(userGames.isWishlisted, true),
        or(eq(games.isReleased, false), isNull(games.isReleased)),
      )
    )
    .orderBy(asc(games.title))
    .all();
  return rows.map((r) => ({ id: r.id, title: r.title, releaseDate: r.releaseDate ?? undefined }));
}

/**
 * Count unreleased wishlisted games (for dashboard/crosslinks).
 */
export function getUnreleasedCount(userId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        eq(userGames.isWishlisted, true),
        or(eq(games.isReleased, false), isNull(games.isReleased)),
      )
    )
    .get();
  return row?.count ?? 0;
}

/**
 * Get games whose isReleased status needs checking (for release status sync).
 * Only checks wishlisted games to avoid unnecessary API calls.
 */
export function getGamesForReleaseCheck(): Array<{ id: number; steamAppId: number; title: string }> {
  const db = getDb();
  return db
    .selectDistinct({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        or(eq(games.isReleased, false), isNull(games.isReleased)),
        eq(userGames.isWishlisted, true),
      )
    )
    .all();
}

/**
 * Mark a game as released.
 */
export function markGameAsReleased(gameId: number): void {
  const db = getDb();
  db.update(games)
    .set({ isReleased: true, updatedAt: new Date().toISOString() })
    .where(eq(games.id, gameId))
    .run();
}

/**
 * Refresh a game's release status from Steam. Updates the `releaseDate` string
 * whenever provided (Steam tightens the date as launch approaches — e.g.
 * "later in 2026" → "Jul 7, 2026") and flips `isReleased` to true on launch.
 */
export function updateReleaseStatus(
  gameId: number,
  patch: { isReleased: boolean; releaseDate?: string | null },
): void {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.isReleased) set.isReleased = true;
  // Only overwrite with a non-empty string. Guards against a Steam blip returning
  // `{ coming_soon: true, date: "" }` and wiping a previously-known good date.
  if (patch.releaseDate) set.releaseDate = patch.releaseDate;
  db.update(games)
    .set(set)
    .where(eq(games.id, gameId))
    .run();
}

// ============================================
// Metadata Refresh
// ============================================

/**
 * Read just the current Early Access flag for a game. Returns the raw value
 * (true/false/null) so callers can distinguish "was EA → now released" from
 * "was unknown" before deciding whether to fire a graduation notification.
 */
export function getEarlyAccessSnapshot(gameId: number): boolean | null {
  const db = getDb();
  const row = db
    .select({ isEarlyAccess: games.isEarlyAccess })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
  return row?.isEarlyAccess ?? null;
}

/**
 * Get games due for a Steam metadata refresh. Drains in LRU order so the
 * least-recently-checked games are picked up first; NULL `metadataLastUpdated`
 * (never refreshed) sorts before any timestamped row.
 *
 * Scope: wishlisted or owned by the given user only. Watchlist-only and
 * lookup-mode (search) games are intentionally excluded.
 */
export function getGamesForMetadataRefresh(
  userId: string,
  batchSize: number,
): Array<{ id: number; steamAppId: number; title: string; metadataLastUpdated: string | null }> {
  const db = getDb();
  return db
    .selectDistinct({
      id: games.id,
      steamAppId: games.steamAppId,
      title: games.title,
      metadataLastUpdated: games.metadataLastUpdated,
    })
    .from(games)
    .innerJoin(userGames, eq(games.id, userGames.gameId))
    .where(
      and(
        eq(userGames.userId, userId),
        or(eq(userGames.isWishlisted, true), eq(userGames.isOwned, true)),
      ),
    )
    // NULLS FIRST is the SQLite default for ASC. Be explicit anyway so a future
    // engine swap (or someone reading this query) sees the intent immediately.
    .orderBy(sql`${games.metadataLastUpdated} IS NULL DESC`, asc(games.metadataLastUpdated))
    .limit(batchSize)
    .all();
}

/**
 * Write a fresh batch of Steam metadata to a game and stamp `metadataLastUpdated`.
 *
 * Always advances the timestamp so the LRU drain rotates even when Steam returns
 * `null` for the row (delisted, rate-limited). `releaseDate` only overwrites
 * with a truthy string (same guard as `updateReleaseStatus` — a Steam blip
 * returning `""` must not wipe a known good date). `isReleased` never flips
 * back to false: once released, always released.
 */
export function updateGameMetadata(
  gameId: number,
  patch: {
    releaseDate?: string | null;
    isReleased?: boolean | null;
    isEarlyAccess?: boolean | null;
    reviewScore?: number | null;
    reviewCount?: number | null;
    reviewDescription?: string | null;
  },
): void {
  const db = getDb();
  const set: Record<string, unknown> = {
    metadataLastUpdated: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (patch.releaseDate) set.releaseDate = patch.releaseDate;
  if (patch.isReleased === true) set.isReleased = true;
  if (patch.isEarlyAccess !== undefined && patch.isEarlyAccess !== null) {
    set.isEarlyAccess = patch.isEarlyAccess;
  }
  if (patch.reviewScore !== undefined && patch.reviewScore !== null) {
    set.reviewScore = patch.reviewScore;
  }
  if (patch.reviewCount !== undefined && patch.reviewCount !== null) {
    set.reviewCount = patch.reviewCount;
  }
  if (patch.reviewDescription !== undefined && patch.reviewDescription !== null) {
    set.reviewDescription = patch.reviewDescription;
  }
  db.update(games).set(set).where(eq(games.id, gameId)).run();
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
  steamPlaytimeMedian: number | null;
  steamPlaytimeSampleSize: number | null;
  steamPlaytimeMissCount: number | null;
  playtimeSource: 'hltb' | 'steam_reviews';
  currentPrice: number | null;
  personalInterest: number;
  interestRatedAt: string | null;
  enjoymentRating: number | null;
  enjoymentRatedAt: string | null;
}

export function getGamesForTriage(view: 'library' | 'wishlist' | 'missing-hltb' | 'value' | undefined, userId: string): TriageGame[] {
  const db = getDb();

  interface RawRow {
    id: number;
    steamAppId: number;
    title: string;
    headerImageUrl: string | null;
    developer: string | null;
    reviewScore: number | null;
    reviewDescription: string | null;
    hltbMain: number | null;
    steamPlaytimeMedian: number | null;
    steamPlaytimeSampleSize: number | null;
    steamPlaytimeMissCount: number | null;
    playtimeSource: string | null;
    personalInterest: number;
    interestRatedAt: string | null;
    enjoymentRating: number | null;
    enjoymentRatedAt: string | null;
    currentPrice: number | null;
  }

  // 'value' = owned + actually played + not yet rated — the opt-in backfill pool
  // for "was it worth it?". Settled (rated) games are intentionally excluded.
  const viewFilter = view === 'library'
    ? sql`AND ug.is_owned = 1`
    : view === 'wishlist'
      ? sql`AND ug.is_wishlisted = 1`
      : view === 'missing-hltb'
        ? sql`AND g.hltb_main IS NULL`
        : view === 'value'
          ? sql`AND ug.is_owned = 1 AND ug.playtime_minutes > 0 AND ug.enjoyment_rating IS NULL`
          : sql``;

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
      g.steam_playtime_median as steamPlaytimeMedian,
      g.steam_playtime_sample_size as steamPlaytimeSampleSize,
      g.steam_playtime_miss_count as steamPlaytimeMissCount,
      ug.playtime_source as playtimeSource,
      ug.personal_interest as personalInterest,
      ug.interest_rated_at as interestRatedAt,
      ug.enjoyment_rating as enjoymentRating,
      ug.enjoyment_rated_at as enjoymentRatedAt,
      (SELECT ps.price_current FROM price_snapshots ps
       WHERE ps.game_id = g.id
       ORDER BY ps.snapshot_date DESC LIMIT 1) as currentPrice
    FROM user_games ug
    INNER JOIN games g ON ug.game_id = g.id
    WHERE ug.user_id = ${userId}
      AND (ug.is_ignored IS NULL OR ug.is_ignored = 0)
      ${viewFilter}
    ORDER BY
      CASE WHEN ${view === 'value' ? sql`ug.enjoyment_rated_at` : sql`ug.interest_rated_at`} IS NULL THEN 0 ELSE 1 END,
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
    steamPlaytimeMedian: r.steamPlaytimeMedian,
    steamPlaytimeSampleSize: r.steamPlaytimeSampleSize,
    steamPlaytimeMissCount: r.steamPlaytimeMissCount,
    playtimeSource: r.playtimeSource === 'steam_reviews' ? 'steam_reviews' : 'hltb',
    currentPrice: r.currentPrice,
    personalInterest: r.personalInterest ?? 3,
    interestRatedAt: r.interestRatedAt,
    enjoymentRating: r.enjoymentRating,
    enjoymentRatedAt: r.enjoymentRatedAt,
  }));
}

export function getMissingHltbCount(userId: string): number {
  const db = getDb();
  const result = db.all(sql`
    SELECT COUNT(*) as count
    FROM user_games ug
    INNER JOIN games g ON ug.game_id = g.id
    WHERE ug.user_id = ${userId}
      AND g.hltb_main IS NULL
  `) as Array<{ count: number }>;
  return result[0]?.count ?? 0;
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
  // Previous snapshot's ATL for new-vs-still-at-ATL classification
  prevHistoricalLowPrice: number | null;
  // Total snapshots observed for this game (gate against firing alerts on too little history)
  snapshotCount: number;
  // When the latest snapshot was recorded — used to suppress re-firing a "new ATL"
  // on a second same-day run, when the daily-deduped snapshot hasn't advanced.
  latestSnapshotAt: string | null;
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
    prevHistoricalLowPrice: number | null;
    snapshotCount: number;
    latestSnapshotAt: string | null;
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
      ps.url as storeUrl,
      (SELECT ps_prev.historical_low_price
       FROM price_snapshots ps_prev
       WHERE ps_prev.game_id = g.id
         AND (ps_prev.snapshot_date < ps.snapshot_date
              OR (ps_prev.snapshot_date = ps.snapshot_date AND ps_prev.id < ps.id))
       ORDER BY ps_prev.snapshot_date DESC, ps_prev.id DESC
       LIMIT 1) as prevHistoricalLowPrice,
      (SELECT COUNT(*) FROM price_snapshots ps_all WHERE ps_all.game_id = g.id) as snapshotCount,
      ps.created_at as latestSnapshotAt
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
    prevHistoricalLowPrice: r.prevHistoricalLowPrice,
    snapshotCount: r.snapshotCount,
    latestSnapshotAt: r.latestSnapshotAt,
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
  }>,
  userId: string
): boolean {
  const db = getDb();
  const result = db
    .update(priceAlerts)
    .set(updates)
    .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
    .run();
  return result.changes > 0;
}

export function deletePriceAlert(alertId: number, userId: string): boolean {
  const db = getDb();
  const result = db
    .delete(priceAlerts)
    .where(and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId)))
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

// ===========================================
// Auto ATL Deal Alerts
// ===========================================

export interface AutoAlertCandidate {
  gameId: number;
  title: string;
  headerImageUrl: string | null;
  steamAppId: number;
  reviewDescription: string | null;
  hltbMain: number | null;
  currentPrice: number;
  regularPrice: number;
  discountPercent: number;
  historicalLowPrice: number | null;
  dealScore: number;
  store: string;
  storeUrl: string | null;
  lastAutoAlertAt: string | null;
  // Previous snapshot's ATL for new-vs-still-at-ATL classification
  prevHistoricalLowPrice: number | null;
  // Total snapshots observed for this game (gate against firing alerts on too little history)
  snapshotCount: number;
  // When the latest snapshot was recorded — used to suppress re-firing a "new ATL"
  // on a second same-day run, when the daily-deduped snapshot hasn't advanced.
  latestSnapshotAt: string | null;
}

/**
 * Get wishlisted, released games at ATL with deal score >= minScore
 * that don't have an explicit price alert and haven't opted out.
 */
export function getAutoAlertCandidates(userId: string, minDealScore: number): AutoAlertCandidate[] {
  const db = getDb();

  interface RawRow {
    gameId: number;
    title: string;
    headerImageUrl: string | null;
    steamAppId: number;
    reviewDescription: string | null;
    hltbMain: number | null;
    currentPrice: number;
    regularPrice: number;
    discountPercent: number;
    historicalLowPrice: number | null;
    dealScore: number;
    store: string;
    storeUrl: string | null;
    lastAutoAlertAt: string | null;
    prevHistoricalLowPrice: number | null;
    snapshotCount: number;
    latestSnapshotAt: string | null;
  }

  const rows = db.all(sql`
    SELECT
      g.id as gameId,
      g.title,
      g.header_image_url as headerImageUrl,
      g.steam_app_id as steamAppId,
      g.review_description as reviewDescription,
      g.hltb_main as hltbMain,
      ps.price_current as currentPrice,
      ps.price_regular as regularPrice,
      ps.discount_percent as discountPercent,
      ps.historical_low_price as historicalLowPrice,
      ps.deal_score as dealScore,
      ps.store,
      ps.url as storeUrl,
      ug.last_auto_alert_at as lastAutoAlertAt,
      (SELECT ps_prev.historical_low_price
       FROM price_snapshots ps_prev
       WHERE ps_prev.game_id = g.id
         AND (ps_prev.snapshot_date < ps.snapshot_date
              OR (ps_prev.snapshot_date = ps.snapshot_date AND ps_prev.id < ps.id))
       ORDER BY ps_prev.snapshot_date DESC, ps_prev.id DESC
       LIMIT 1) as prevHistoricalLowPrice,
      (SELECT COUNT(*) FROM price_snapshots ps_all WHERE ps_all.game_id = g.id) as snapshotCount,
      ps.created_at as latestSnapshotAt
    FROM user_games ug
    INNER JOIN games g ON ug.game_id = g.id
    INNER JOIN price_snapshots ps ON g.id = ps.game_id
      AND ps.id = (
        SELECT ps2.id FROM price_snapshots ps2
        WHERE ps2.game_id = g.id
        ORDER BY ps2.snapshot_date DESC, ps2.deal_score DESC
        LIMIT 1
      )
    WHERE ug.user_id = ${userId}
      AND ug.is_wishlisted = 1
      AND (ug.auto_alert_disabled = 0 OR ug.auto_alert_disabled IS NULL)
      AND g.is_released = 1
      AND ps.is_historical_low = 1
      AND (ps.deal_score >= ${minDealScore} OR ps.price_current = 0)
      AND NOT EXISTS (
        SELECT 1 FROM price_alerts pa
        WHERE pa.game_id = g.id AND pa.user_id = ${userId}
      )
  `) as RawRow[];

  return rows;
}

export function updateAutoAlertLastNotified(gameId: number, userId: string): void {
  const db = getDb();
  db.update(userGames)
    .set({ lastAutoAlertAt: new Date().toISOString() })
    .where(and(eq(userGames.gameId, gameId), eq(userGames.userId, userId)))
    .run();
}

// ============================================
// Dashboard Charts
// ============================================

/**
 * Top genres across all user games (owned + wishlisted), counted by game.
 * Returns top N genres sorted by count descending.
 */
export function getGenreDistribution(userId: string, limit = 8): Array<{ name: string; count: number }> {
  const db = getDb();
  const rows = db.all(sql`
    SELECT t.name, COUNT(DISTINCT gt.game_id) as count
    FROM tags t
    JOIN game_tags gt ON gt.tag_id = t.id
    JOIN user_games ug ON ug.game_id = gt.game_id
    WHERE t.type = 'genre'
      AND ug.user_id = ${userId}
      AND (ug.is_owned = 1 OR (ug.is_wishlisted = 1 AND ug.wishlist_removed_at IS NULL))
    GROUP BY t.name
    ORDER BY count DESC
    LIMIT ${limit}
  `) as Array<{ name: string; count: number }>;
  return rows;
}

/**
 * Distribution of deal scores across user's games with active pricing.
 * Uses getLatestPriceSnapshots (the same function game cards use) to guarantee
 * the chart buckets match what's displayed on wishlist/library pages.
 */
export function getDealScoreDistribution(userId: string): Array<{ bucket: string; count: number }> {
  const db = getDb();
  const { weights, thresholds } = getScoringConfig();

  // Get all user game IDs (owned or wishlisted)
  const userGameRows = db.all(sql`
    SELECT ug.game_id as gameId, ug.personal_interest as personalInterest,
           ug.playtime_source as playtimeSource,
           g.review_score as reviewScore, g.hltb_main as hltbMain,
           g.steam_playtime_median as steamPlaytimeMedian,
           g.is_released as isReleased
    FROM user_games ug
    JOIN games g ON g.id = ug.game_id
    WHERE ug.user_id = ${userId}
      AND (ug.is_owned = 1 OR (ug.is_wishlisted = 1 AND ug.wishlist_removed_at IS NULL))
  `) as Array<{
    gameId: number;
    personalInterest: number | null;
    playtimeSource: string | null;
    reviewScore: number | null;
    hltbMain: number | null;
    steamPlaytimeMedian: number | null;
    isReleased: number | null;
  }>;

  if (userGameRows.length === 0) return [];

  // Use the exact same snapshot function that game cards use
  const gameIds = userGameRows.map((r) => r.gameId);
  const snapshots = getLatestPriceSnapshots(gameIds);
  const gameDataMap = new Map(userGameRows.map((r) => [r.gameId, r]));

  const buckets: Record<string, number> = { Poor: 0, Okay: 0, Good: 0, Great: 0, Excellent: 0 };

  for (const [gameId, snapshot] of snapshots) {
    if (snapshot.priceCurrent <= 0) continue;
    const gameData = gameDataMap.get(gameId);
    if (!gameData) continue;

    const score = calculateDealScore({
      currentPrice: snapshot.priceCurrent,
      regularPrice: snapshot.priceRegular,
      historicalLow: snapshot.historicalLowPrice ?? snapshot.priceCurrent,
      reviewPercent: gameData.reviewScore,
      hltbMainHours: getEffectivePlaytimeHours({
        ...gameData,
        isReleased: gameData.isReleased == null ? null : gameData.isReleased === 1,
      }),
      personalInterest: gameData.personalInterest ?? 3,
    }, weights, thresholds);

    // Thresholds match getScoreRating() in scoring/engine.ts
    if (score.overall >= 85) buckets.Excellent++;
    else if (score.overall >= 70) buckets.Great++;
    else if (score.overall >= 55) buckets.Good++;
    else if (score.overall >= 40) buckets.Okay++;
    else buckets.Poor++;
  }

  return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
}

export type ValueReceivedBucket = ValueReceivedTier | 'none';

export interface ValueReceivedOverview {
  /** Owned-game counts per value tier, plus a "none" bucket (no baseline to grade). */
  distribution: Array<{ bucket: ValueReceivedBucket; count: number }>;
  stats: {
    totalSpent: number; // sum of recorded price_paid across owned games (USD)
    pricedGames: number; // owned games with a recorded price
    totalHours: number; // total hours played across owned games
    blendedDollarsPerHour: number | null; // totalSpent(money-lens) / hours(money-lens)
    expectedValueHits: number; // money-lens games that reached/exceeded expected value
    moneyLensGames: number; // owned games graded on the money lens (priced + played)
  };
}

/**
 * Dashboard rollup of Value Received across the owned library. Computes each game's
 * tier in JS via {@link calculateValueReceived} (the score has no stored column), so
 * the donut and the stat tile stay in lockstep with the per-card badges.
 */
export function getValueReceivedOverview(userId: string): ValueReceivedOverview {
  const db = getDb();
  const { thresholds } = getScoringConfig();

  const rows = db.all(sql`
    SELECT ug.playtime_minutes as playtimeMinutes,
           ug.price_paid as pricePaid,
           ug.playtime_source as playtimeSource,
           g.review_score as reviewScore,
           g.hltb_main as hltbMain,
           g.steam_playtime_median as steamPlaytimeMedian
    FROM user_games ug
    JOIN games g ON g.id = ug.game_id
    WHERE ug.user_id = ${userId} AND ug.is_owned = 1
  `) as Array<{
    playtimeMinutes: number | null;
    pricePaid: number | null;
    playtimeSource: string | null;
    reviewScore: number | null;
    hltbMain: number | null;
    steamPlaytimeMedian: number | null;
  }>;

  const buckets: Record<ValueReceivedBucket, number> = {
    exceeded: 0,
    realized: 0,
    approaching: 0,
    unrealized: 0,
    none: 0,
  };

  let totalSpent = 0;
  let pricedGames = 0;
  let totalMinutes = 0;
  let moneyLensSpent = 0;
  let moneyLensMinutes = 0;
  let expectedValueHits = 0;
  let moneyLensGames = 0;

  for (const r of rows) {
    const vr = calculateValueReceived(
      {
        playtimeMinutes: r.playtimeMinutes ?? 0,
        hltbMainHours: getEffectivePlaytimeHours(r),
        reviewPercent: r.reviewScore,
        pricePaid: r.pricePaid,
      },
      thresholds,
    );

    buckets[vr.lens === 'none' ? 'none' : vr.tier]++;
    totalMinutes += Math.max(0, r.playtimeMinutes ?? 0);
    if (r.pricePaid != null && r.pricePaid > 0) {
      totalSpent += r.pricePaid;
      pricedGames++;
    }
    if (vr.lens === 'money') {
      // Money lens implies pricePaid > 0 and playtime > 0 (see calculateValueReceived).
      moneyLensGames++;
      moneyLensSpent += r.pricePaid ?? 0;
      moneyLensMinutes += Math.max(0, r.playtimeMinutes ?? 0);
      if (vr.receivedExpectedValue) expectedValueHits++;
    }
  }

  const moneyLensHours = moneyLensMinutes / 60;
  const blendedDollarsPerHour =
    moneyLensHours > 0 ? Math.round((moneyLensSpent / moneyLensHours) * 100) / 100 : null;

  return {
    distribution: (Object.keys(buckets) as ValueReceivedBucket[]).map((bucket) => ({
      bucket,
      count: buckets[bucket],
    })),
    stats: {
      totalSpent: Math.round(totalSpent * 100) / 100,
      pricedGames,
      totalHours: Math.round(totalMinutes / 60),
      blendedDollarsPerHour,
      expectedValueHits,
      moneyLensGames,
    },
  };
}

export type ActivityType = 'wishlisted' | 'played' | 'new_atl';

export interface ActivityEvent {
  type: ActivityType;
  gameId: number;
  title: string;
  detail: string;
  date: string;
}

/**
 * Recently wishlisted games (the "New Wishlisted" activity tab).
 *
 * Ordered by the true Steam wishlist-add date (`wishlisted_at`) when known,
 * falling back to Hoard's `created_at` for Hoard-only/local entries and rows
 * predating that column. Only currently-wishlisted games (not removed locally)
 * qualify — a game you've since unwishlisted is no longer news.
 */
export function getRecentWishlisted(userId: string, limit = 10): ActivityEvent[] {
  const db = getDb();

  const rows = db.all(sql`
    SELECT
      g.id as game_id,
      g.title,
      SUBSTR(COALESCE(ug.wishlisted_at, ug.created_at), 1, 10) as date
    FROM user_games ug
    JOIN games g ON g.id = ug.game_id
    WHERE ug.user_id = ${userId}
      AND ug.is_wishlisted = 1
      AND ug.wishlist_removed_at IS NULL
    ORDER BY COALESCE(ug.wishlisted_at, ug.created_at) DESC
    LIMIT ${limit}
  `) as Array<{ game_id: number; title: string; date: string }>;

  return rows.map((r) => ({
    type: 'wishlisted' as const,
    gameId: r.game_id,
    title: r.title,
    detail: 'Added to wishlist',
    date: r.date,
  }));
}

/**
 * Recently played games (the "Played" activity tab). Owned games with a
 * `last_played` timestamp and non-zero playtime, most-recently-played first.
 * Deal/price events live on the New ATLs tab via {@link getRecentAtlEvents}.
 */
export function getRecentPlayed(userId: string, limit = 10): ActivityEvent[] {
  const db = getDb();

  const rows = db.all(sql`
    SELECT
      g.id as game_id,
      g.title,
      ROUND(ug.playtime_minutes / 60.0, 1) || 'h played' as detail,
      ug.last_played as date
    FROM user_games ug
    JOIN games g ON g.id = ug.game_id
    WHERE ug.user_id = ${userId}
      AND ug.is_owned = 1
      AND ug.last_played IS NOT NULL
      AND ug.playtime_minutes > 0
    ORDER BY ug.last_played DESC
    LIMIT ${limit}
  `) as Array<{ game_id: number; title: string; detail: string; date: string }>;

  return rows.map((r) => ({
    type: 'played' as const,
    gameId: r.game_id,
    title: r.title,
    detail: r.detail,
    date: r.date,
  }));
}

/**
 * New all-time-low events from the past N days. A NEW ATL is a snapshot where
 * is_historical_low=1 AND no prior snapshot (including backfilled history) had
 * a price equal to or lower than this one. Filters out games sitting at a
 * previously-known ATL — those are not news.
 */
export function getRecentAtlEvents(
  userId: string,
  daysBack = 14,
  limit = 10,
): ActivityEvent[] {
  const db = getDb();

  const rows = db.all(sql`
    SELECT
      g.id as game_id,
      g.title,
      ps.price_current as price_current,
      ps.discount_percent as discount_percent,
      ps.snapshot_date as date
    FROM price_snapshots ps
    JOIN games g ON g.id = ps.game_id
    JOIN user_games ug ON ug.game_id = g.id AND ug.user_id = ${userId}
    WHERE ps.is_historical_low = 1
      AND ps.snapshot_date >= date('now', '-' || ${daysBack} || ' days')
      AND (ug.is_owned = 1 OR (ug.is_wishlisted = 1 AND ug.wishlist_removed_at IS NULL))
      AND NOT EXISTS (
        SELECT 1 FROM price_snapshots ps_prior
        WHERE ps_prior.game_id = ps.game_id
          AND ps_prior.snapshot_date < ps.snapshot_date
          AND ps_prior.price_current <= ps.price_current
      )
      -- Pin to the most recent qualifying new-ATL snapshot per game so the
      -- displayed price/discount/date match the row that drives ordering.
      AND ps.snapshot_date = (
        SELECT MAX(ps_latest.snapshot_date) FROM price_snapshots ps_latest
        WHERE ps_latest.game_id = ps.game_id
          AND ps_latest.is_historical_low = 1
          AND ps_latest.snapshot_date >= date('now', '-' || ${daysBack} || ' days')
          AND NOT EXISTS (
            SELECT 1 FROM price_snapshots ps_prior2
            WHERE ps_prior2.game_id = ps_latest.game_id
              AND ps_prior2.snapshot_date < ps_latest.snapshot_date
              AND ps_prior2.price_current <= ps_latest.price_current
          )
      )
    GROUP BY g.id
    ORDER BY ps.snapshot_date DESC
    LIMIT ${limit}
  `) as Array<{ game_id: number; title: string; price_current: number; discount_percent: number; date: string }>;

  return rows.map((r) => ({
    type: 'new_atl' as const,
    gameId: r.game_id,
    title: r.title,
    detail: r.discount_percent > 0
      ? `$${r.price_current.toFixed(2)} (-${r.discount_percent}%) new low`
      : `$${r.price_current.toFixed(2)} new low`,
    date: r.date,
  }));
}
