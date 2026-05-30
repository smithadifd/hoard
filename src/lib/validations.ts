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
  view: z.enum(['library', 'wishlist', 'watchlist', 'recent-deals', 'new-atls', 'deepest-discounts', 'heating-up']).optional(),
  daysBack: z.coerce.number().int().min(1).max(365).optional(),
  owned: booleanString.optional(),
  played: booleanString.optional(),
  playtimeStatus: z.enum(['unplayed', 'underplayed', 'backlog', 'play-again']).optional(),
  maxHours: z.coerce.number().min(0).max(10000).optional(),
  minHours: z.coerce.number().min(0).max(10000).optional(),
  coop: booleanString.optional(),
  multiplayer: booleanString.optional(),
  minReview: z.coerce.number().int().min(0).max(100).optional(),
  maxReviewCount: z.coerce.number().int().min(0).max(1000000).optional(),
  maxPrice: z.coerce.number().min(0).max(10000).optional(),
  onSale: booleanString.optional(),
  strictFilters: booleanString.optional(),
  requireCompleteData: booleanString.optional(),
  hideUnreleased: booleanString.optional(),
  earlyAccess: booleanString.optional(),
  minInterest: z.coerce.number().int().min(1).max(5).optional(),
  genres: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  excludeTags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  sortBy: z.enum(['title', 'playtime', 'review', 'price', 'dealScore', 'hltbMain', 'releaseDate', 'lastPlayed', 'atlHitDate', 'discount', 'belowAvgPercent', 'valueWaiting']).default('title'),
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
  autoAlertDisabled: z.boolean().optional(),
  isWishlisted: z.boolean().optional(),
  priceThreshold: z.number().min(0).max(10000).optional(),
  // What the user paid for an owned game (USD); null clears → reverts to time lens
  pricePaid: z.number().min(0).max(100000).nullable().optional(),
  // Action flag: "Not now" on a price-paid suggestion → server stamps pricePaidSuggestionDismissedAt
  dismissPriceSuggestion: z.boolean().optional(),
  // Manual HLTB data entry (null to clear)
  hltbMain: z.number().min(0).max(10000).nullable().optional(),
  hltbMainExtra: z.number().min(0).max(10000).nullable().optional(),
  hltbCompletionist: z.number().min(0).max(10000).nullable().optional(),
  // Exclude game from HLTB sync entirely (true = stop looking, false = resume sync)
  hltbExcluded: z.boolean().optional(),
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
  'discord_ops_webhook_url',
  'scoring_weights',
  'scoring_thresholds',
  'alert_throttle_hours',
  'backlog_threshold_percent',
  'play_again_completion_pct',
  'play_again_dormant_months',
  'auto_atl_deal_alerts',
  'min_snapshots_for_atl_alert',
  'price_paid_suggestions_enabled',
  'notification_preferences',
]);

// Shape of the notification_preferences JSON blob. Sections are optional (the
// getter deep-merges over defaults), but any present value is range-checked.
const notificationPreferencesSchema = z.object({
  categories: z
    .record(z.string(), z.object({ inApp: z.boolean(), discord: z.boolean() }))
    .optional(),
  frequency: z.object({ throttleHours: z.number().int().min(1).max(168) }).optional(),
  quietHours: z
    .object({
      enabled: z.boolean(),
      start: z.number().int().min(0).max(23),
      end: z.number().int().min(0).max(23),
    })
    .optional(),
});

export const settingsUpdateSchema = z.object({
  settings: z.record(settingsKeyEnum, z.string().max(5000).optional()),
}).superRefine((data, ctx) => {
  const webhookKeys = ['discord_webhook_url', 'discord_ops_webhook_url'] as const;
  for (const key of webhookKeys) {
    const val = data.settings[key];
    if (val) {
      try {
        const url = new URL(val);
        if (url.hostname !== 'discord.com' && url.hostname !== 'discordapp.com') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', key], message: 'Must be a discord.com webhook URL' });
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', key], message: 'Invalid URL' });
      }
    }
  }

  const prefsRaw = data.settings['notification_preferences'];
  if (prefsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(prefsRaw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', 'notification_preferences'], message: 'Invalid JSON' });
      return;
    }
    if (!notificationPreferencesSchema.safeParse(parsed).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', 'notification_preferences'],
        message: 'Invalid notification preferences',
      });
    }
  }
});

// ============================================
// HLTB
// ============================================

export const hltbSearchSchema = z.object({
  query: z.string().min(1).max(200),
});

// ============================================
// Sync
// ============================================

export const syncTriggerSchema = z.object({
  type: z.enum([
    'library',
    'wishlist',
    'prices',
    'hltb',
    'reviews',
    'price-history-backfill',
    'price-history-prime',
  ]),
});
