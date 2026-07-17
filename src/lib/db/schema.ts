import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ===========================================
// Games - Central entity caching all game data
// ===========================================
export const games = sqliteTable('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  steamAppId: integer('steam_app_id').unique().notNull(),
  itadGameId: text('itad_game_id'),
  title: text('title').notNull(),
  description: text('description'),
  shortDescription: text('short_description'),
  headerImageUrl: text('header_image_url'),
  capsuleImageUrl: text('capsule_image_url'),
  releaseDate: text('release_date'),
  developer: text('developer'),
  publisher: text('publisher'),
  // Review data from Steam
  reviewScore: integer('review_score'), // 0-100 percentage
  reviewCount: integer('review_count'),
  reviewDescription: text('review_description'), // "Overwhelmingly Positive", etc.
  // HowLongToBeat data
  hltbId: integer('hltb_id'),
  hltbMain: real('hltb_main'), // hours - main story
  hltbMainExtra: real('hltb_main_extra'), // hours - main + extras
  hltbCompletionist: real('hltb_completionist'), // hours - completionist
  hltbLastUpdated: text('hltb_last_updated'), // ISO date
  hltbManual: integer('hltb_manual', { mode: 'boolean' }).default(false), // User-entered or explicitly excluded HLTB data
  hltbMissCount: integer('hltb_miss_count').default(0), // Consecutive failed HLTB lookups (for backoff)
  // Steam-review playtime — median of sampled reviewers' total playtime (SteamDB-style).
  // An alternative "expected playtime" basis for indie/open-ended games where HLTB is thin.
  steamPlaytimeMedian: real('steam_playtime_median'), // hours
  steamPlaytimeSampleSize: integer('steam_playtime_sample_size'), // # of reviews the median is drawn from
  steamPlaytimeUpdatedAt: text('steam_playtime_updated_at'), // ISO date
  steamPlaytimeMissCount: integer('steam_playtime_miss_count').default(0), // Consecutive failed/too-small samples (for backoff)
  // Review metadata tracking
  reviewLastUpdated: text('review_last_updated'), // ISO date — tracks when reviews were fetched
  // ITAD price history backfill tracking
  priceHistoryBackfilledAt: integer('price_history_backfilled_at', { mode: 'timestamp_ms' }), // Set when full ITAD history has been ingested; NULL = needs backfill
  priceHistoryMissCount: integer('price_history_miss_count').default(0), // Consecutive backfill failures (for backoff)
  // Metadata
  isCoop: integer('is_coop', { mode: 'boolean' }).default(false),
  isMultiplayer: integer('is_multiplayer', { mode: 'boolean' }).default(false),
  isReleased: integer('is_released', { mode: 'boolean' }),
  isEarlyAccess: integer('is_early_access', { mode: 'boolean' }), // NULL = unknown / never enriched; set by metadata refresh
  metadataLastUpdated: text('metadata_last_updated'), // ISO timestamp — tracks when Steam metadata was last refreshed
  // Source tracking
  source: text('source').notNull().default('sync'), // 'sync' = imported via Steam library/wishlist; 'lookup' = created via search
  lastViewedAt: integer('last_viewed_at', { mode: 'timestamp' }), // Updated when a lookup-mode detail page is viewed
  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ===========================================
// Tags - Genres, categories, Steam tags
// ===========================================
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'genre', 'category', 'tag'
}, (table) => ({
  nameTypeIdx: uniqueIndex('tag_name_type_idx').on(table.name, table.type),
}));

export const gameTags = sqliteTable('game_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  tagId: integer('tag_id').references(() => tags.id, { onDelete: 'cascade' }).notNull(),
}, (table) => ({
  gameTagIdx: uniqueIndex('game_tag_idx').on(table.gameId, table.tagId),
}));

// ===========================================
// User Games - User's relationship to games
// ===========================================
export const userGames = sqliteTable('user_games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().default('default'), // Future multi-user support
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  // Ownership & status
  isOwned: integer('is_owned', { mode: 'boolean' }).default(false),
  isWishlisted: integer('is_wishlisted', { mode: 'boolean' }).default(false),
  isWatchlisted: integer('is_watchlisted', { mode: 'boolean' }).default(false),
  isIgnored: integer('is_ignored', { mode: 'boolean' }).default(false),
  wishlistRemovedAt: text('wishlist_removed_at'), // ISO timestamp; non-null = removed locally
  // Hoard-only wishlist: true = wishlisted in Hoard but NOT on the user's Steam wishlist.
  // Survives Steam wishlist sync auto-removal; cleared on reconciliation if it later appears on Steam.
  wishlistedLocally: integer('wishlisted_locally', { mode: 'boolean' }).notNull().default(false),
  // True Steam wishlist-add date (Unix date_added → ISO), captured from the wishlist sync.
  // Set-if-null so it stays stable across syncs. NULL for Hoard-only/local wishlist entries
  // (never on Steam) and for rows predating this column until the next wishlist sync backfills it.
  // The only honest source of wishlist age — created_at reflects Hoard's lifetime, not the wishlist's.
  wishlistedAt: text('wishlisted_at'),
  autoAlertDisabled: integer('auto_alert_disabled', { mode: 'boolean' }).default(false), // Opt out of auto ATL deal alerts
  lastAutoAlertAt: text('last_auto_alert_at'), // Throttle tracking for auto ATL deal alerts
  // Playtime from Steam
  playtimeMinutes: integer('playtime_minutes').default(0),
  playtimeRecentMinutes: integer('playtime_recent_minutes').default(0), // last 2 weeks
  lastPlayed: text('last_played'), // ISO date
  // Which playtime basis feeds $/hour scoring for this game: 'hltb' (default) or
  // 'steam_reviews' (median of sampled reviewer playtime). Each falls back to the
  // other when its own source has no data — see getEffectivePlaytimeHours.
  playtimeSource: text('playtime_source').notNull().default('hltb'),
  // Personal scoring
  personalInterest: integer('personal_interest').default(3), // 1-5 scale — pre-purchase enthusiasm ("the bet")
  interestRatedAt: text('interest_rated_at'), // ISO date — NULL means never explicitly rated
  // Post-play enjoyment ("the payoff") — drives the rating-led Value Received verdict.
  // NULL = unrated → falls back to the efficiency/time lens, exactly like today.
  enjoymentRating: integer('enjoyment_rating'), // 1-5 scale, nullable
  enjoymentRatedAt: text('enjoyment_rated_at'), // ISO date — NULL means never rated
  priceThreshold: real('price_threshold'), // Alert when price drops below
  notes: text('notes'),
  // Value received (backward-looking) — what the user actually paid for an owned game
  pricePaid: real('price_paid'), // USD, nullable — user-entered; NULL = use time/completion lens only
  pricePaidAt: text('price_paid_at'), // ISO date the price was recorded
  // Price-paid suggestion (Phase 3) — system estimate captured at purchase detection; never auto-applied
  pricePaidSuggested: real('price_paid_suggested'), // USD, nullable — proposed at wishlist→owned flip; user confirms/edits/dismisses
  pricePaidSuggestionDismissedAt: text('price_paid_suggestion_dismissed_at'), // ISO; non-null = dismissed, don't re-surface
  // Backlog lifecycle (issue #12) — where the user is with an owned game.
  // 'unplayed' (default) | 'playing' | 'beaten' | 'completed' | 'abandoned'.
  // Distinct from raw playtime: lets the backlog hide finished games and the
  // recommender skip games the user has consciously closed out.
  completionStatus: text('completion_status').notNull().default('unplayed'),
  // Explicit Up-Next queue intent that OVERRIDES the derived bucket. NULL = derive
  // from signals; 'shortlisted' = pin to Up Next; 'snoozed' = hide for now;
  // 'dropped' = removed from the queue by the user (distinct from the 'abandoned'
  // completion outcome — a dropped game can still be revisited later).
  backlogState: text('backlog_state'),
  // User-assigned play priority; higher = wants to play sooner. NULL = unset
  // (the common case — the picker is meant to work with zero manual triage).
  priority: integer('priority'),
  // When the game first transitioned to a played state (ISO). NULL until started.
  startedAt: text('started_at'),
  // When the game was marked 'abandoned' (ISO). NULL unless currently abandoned.
  abandonedAt: text('abandoned_at'),
  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  userGameIdx: uniqueIndex('user_game_idx').on(table.userId, table.gameId),
  gameIdx: index('ug_game_idx').on(table.gameId),
  ownedIdx: index('ug_owned_idx').on(table.userId, table.isOwned),
  wishlistedIdx: index('ug_wishlisted_idx').on(table.userId, table.isWishlisted),
  watchlistedIdx: index('ug_watchlisted_idx').on(table.userId, table.isWatchlisted),
  completionIdx: index('ug_completion_idx').on(table.userId, table.completionStatus),
}));

// ===========================================
// Price Snapshots - Historical price tracking
// ===========================================
export const priceSnapshots = sqliteTable('price_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  store: text('store').notNull(), // 'steam', 'gog', 'humble', 'greenmangaming', etc.
  priceCurrent: real('price_current').notNull(), // Current/sale price
  priceRegular: real('price_regular').notNull(), // Regular/base price
  discountPercent: integer('discount_percent').default(0),
  currency: text('currency').default('USD'),
  url: text('url'), // Direct link to store page
  isHistoricalLow: integer('is_historical_low', { mode: 'boolean' }).default(false),
  historicalLowPrice: real('historical_low_price'), // ATL from ITAD
  dealScore: integer('deal_score'), // Computed deal score (0-100) for SQL sorting
  snapshotDate: text('snapshot_date').notNull(), // ISO date
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  gameSnapshotIdx: index('ps_game_snapshot_idx').on(table.gameId, table.snapshotDate),
  gameStoreSnapshotIdx: uniqueIndex('ps_game_store_snapshot_idx')
    .on(table.gameId, table.store, table.snapshotDate),
}));

// ===========================================
// Playtime Snapshots - Historical playtime time-series
// ===========================================
// One row per (game, user, day). Steam library-sync OVERWRITES
// user_games.playtimeMinutes each run, destroying the prior total; this table
// preserves the series so Hoard can derive hours-this-week/month, value-accrual
// ($/hr improving as hours grow), and momentum (playing/dormant). Mirrors the
// price_snapshots pattern: current value captured per sync, deduped per day,
// pruned on the same retention window.
export const playtimeSnapshots = sqliteTable('playtime_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').notNull().default('default'),
  playtimeMinutes: integer('playtime_minutes').notNull(), // cumulative total (Steam playtime_forever) as of snapshotDate
  recentMinutes: integer('recent_minutes').default(0), // Steam rolling 2-week (playtime_2weeks) at capture
  lastPlayed: text('last_played'), // ISO date from Steam rtime_last_played; NULL when never played
  snapshotDate: text('snapshot_date').notNull(), // ISO date (YYYY-MM-DD)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  gameSnapshotIdx: index('pts_game_snapshot_idx').on(table.gameId, table.snapshotDate),
  gameUserSnapshotIdx: uniqueIndex('pts_game_user_snapshot_idx')
    .on(table.gameId, table.userId, table.snapshotDate),
}));

// ===========================================
// Price Alerts - Watchlist configuration
// ===========================================
export const priceAlerts = sqliteTable('price_alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().default('default'),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  targetPrice: real('target_price'), // Notify when price hits this
  notifyOnAllTimeLow: integer('notify_on_all_time_low', { mode: 'boolean' }).default(true),
  notifyOnThreshold: integer('notify_on_threshold', { mode: 'boolean' }).default(true),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  lastNotifiedAt: text('last_notified_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  userGameIdx: uniqueIndex('alert_user_game_idx').on(table.userId, table.gameId),
  activeIdx: index('alert_active_idx').on(table.userId, table.isActive),
}));

// ===========================================
// Settings - App configuration (scoring weights, etc.)
// ===========================================
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON-encoded values
  description: text('description'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ===========================================
// Sync Log - Track API sync operations
// ===========================================
export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(), // 'steam_library', 'steam_wishlist', 'itad_prices', 'hltb'
  status: text('status').notNull(), // 'running', 'success', 'partial', 'error'
  itemsProcessed: integer('items_processed').default(0),
  itemsAttempted: integer('items_attempted').default(0),
  itemsFailed: integer('items_failed').default(0),
  apiCalls: integer('api_calls'), // External API calls made during this run; NULL for syncs that don't track or don't hit external APIs
  errorMessage: text('error_message'),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
}, (table) => ({
  sourceStartedIdx: index('sl_source_started_idx').on(table.source, table.startedAt),
}));

// ===========================================
// Better Auth - Authentication tables
// ===========================================
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
});

// ===========================================
// Notifications - In-app notification center
// ===========================================
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  // 'drain-complete' | 'drain-paused' | 'sync-failure' | 'triage-nudge' | 'milestone' | 'deal-alert' | 'release' | 'system'
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  metadata: text('metadata'), // JSON blob
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  readAt: integer('read_at', { mode: 'timestamp_ms' }),
  dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
}, (t) => ({
  userUnreadIdx: index('notif_user_unread_idx').on(t.userId, t.readAt),
  userCreatedIdx: index('notif_user_created_idx').on(t.userId, t.createdAt),
}));

// ===========================================
// Recommendation Events - implicit learning signal for the Up Next picker
// ===========================================
// One append-only row per surfaced pick. `shownAt` is stamped when the picker
// shows a game; `acceptedAt` / `dismissedAt` record what the user did with it.
// These implicit signals feed the ranker (dismissal cooldowns, accept-rate) so
// the queue personalises with ZERO manual triage — honest engagement, not a
// growth metric. `reason` stores the one concrete explanation that was shown.
export const recommendationEvents = sqliteTable('recommendation_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().default('default'),
  gameId: integer('game_id').references(() => games.id, { onDelete: 'cascade' }).notNull(),
  bucket: text('bucket').notNull(), // 'continue' | 'finish-soon' | 'start-fresh' | 'drop'
  reason: text('reason').notNull(), // the concrete explanation shown to the user
  score: real('score'), // ranking score at surfacing time (for tuning/audit)
  shownAt: text('shown_at').notNull().default(sql`(datetime('now'))`), // ISO
  acceptedAt: text('accepted_at'), // user opened/started the pick
  dismissedAt: text('dismissed_at'), // user dismissed/snoozed the pick
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => ({
  userGameIdx: index('re_user_game_idx').on(t.userId, t.gameId),
  userShownIdx: index('re_user_shown_idx').on(t.userId, t.shownAt),
}));
