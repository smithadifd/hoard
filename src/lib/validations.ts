import { z } from 'zod';

// ============================================
// Helpers
// ============================================

/**
 * Convert URLSearchParams to a plain object, only including keys that are present.
 * This allows Zod .optional() and .default() to work correctly.
 */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const obj: Record<string, string> = {};
  params.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

/**
 * Format a Zod error into a clean string for API responses.
 */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

// ============================================
// Shared Primitives
// ============================================

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

// ============================================
// Games
// ============================================

export const gameFiltersSchema = z.object({
  search: z.string().max(200).optional(),
  view: z.enum(['library', 'wishlist', 'watchlist']).optional(),
  owned: booleanString.optional(),
  played: booleanString.optional(),
  playtimeStatus: z.enum(['unplayed', 'underplayed']).optional(),
  maxHours: z.coerce.number().min(0).max(10000).optional(),
  minHours: z.coerce.number().min(0).max(10000).optional(),
  coop: booleanString.optional(),
  multiplayer: booleanString.optional(),
  minReview: z.coerce.number().int().min(0).max(100).optional(),
  maxPrice: z.coerce.number().min(0).max(10000).optional(),
  onSale: booleanString.optional(),
  sortBy: z.enum(['title', 'playtime', 'review', 'price', 'dealScore', 'hltbMain', 'releaseDate']).default('title'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const gameIdSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const gameUpdateSchema = z.object({
  personalInterest: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
  isWatchlisted: z.boolean().optional(),
  isIgnored: z.boolean().optional(),
  priceThreshold: z.number().min(0).max(10000).optional(),
});

export const interestSchema = z.object({
  gameId: z.number().int().min(1),
  interest: z.number().int().min(1).max(5),
});

// ============================================
// Alerts
// ============================================

export const alertIdSchema = z.object({
  id: z.coerce.number().int().min(1),
});

export const alertUpsertSchema = z.object({
  gameId: z.number().int().min(1),
  targetPrice: z.number().min(0).max(10000).optional(),
  notifyOnAllTimeLow: z.boolean().optional(),
  notifyOnThreshold: z.boolean().optional(),
});

export const alertUpdateSchema = z.object({
  targetPrice: z.number().min(0).max(10000).optional(),
  notifyOnAllTimeLow: z.boolean().optional(),
  notifyOnThreshold: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ============================================
// Settings
// ============================================

const settingsKeyEnum = z.enum([
  'steam_api_key',
  'steam_user_id',
  'itad_api_key',
  'discord_webhook_url',
  'scoring_weights',
  'scoring_thresholds',
  'alert_throttle_hours',
]);

export const settingsUpdateSchema = z.object({
  settings: z.record(settingsKeyEnum, z.string().max(5000)),
});

// ============================================
// Sync
// ============================================

export const syncTriggerSchema = z.object({
  type: z.enum(['library', 'wishlist', 'prices', 'hltb', 'reviews']),
});
