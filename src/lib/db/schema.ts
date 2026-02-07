import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  // Metadata
  isCoop: integer('is_coop', { mode: 'boolean' }).default(false),
  isMultiplayer: integer('is_multiplayer', { mode: 'boolean' }).default(false),
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
  // Playtime from Steam
  playtimeMinutes: integer('playtime_minutes').default(0),
  playtimeRecentMinutes: integer('playtime_recent_minutes').default(0), // last 2 weeks
  lastPlayed: text('last_played'), // ISO date
  // Personal scoring
  personalInterest: integer('personal_interest').default(3), // 1-5 scale
  priceThreshold: real('price_threshold'), // Alert when price drops below
  notes: text('notes'),
  // Timestamps
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => ({
  userGameIdx: uniqueIndex('user_game_idx').on(table.userId, table.gameId),
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
});

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
  status: text('status').notNull(), // 'running', 'success', 'error'
  itemsProcessed: integer('items_processed').default(0),
  errorMessage: text('error_message'),
  startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
});
