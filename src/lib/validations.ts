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
  rated: booleanString.optional(),
  valueReceivedTier: z.enum(['unrealized', 'approaching', 'realized', 'exceeded']).optional(),
  genres: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  excludeTags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  sortBy: z.enum(['title', 'playtime', 'review', 'price', 'dealScore', 'hltbMain', 'releaseDate', 'lastPlayed', 'atlHitDate', 'discount', 'belowAvgPercent', 'valueWaiting', 'pricePaid', 'completionRatio', 'realizedDollarsPerHour', 'valueReceived']).default('title'),
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
  // Hoard-only wishlist flag — true = wishlisted in Hoard but not on the Steam wishlist
  wishlistedLocally: z.boolean().optional(),
  priceThreshold: z.number().min(0).max(10000).optional(),
  // What the user paid for an owned game (USD); null clears → reverts to time lens
  pricePaid: z.number().min(0).max(100000).nullable().optional(),
  // Post-play enjoyment rating (1-5); null clears → reverts to efficiency/time lens
  enjoymentRating: z.number().int().min(1).max(5).nullable().optional(),
  // Action flag: "Not now" on a price-paid suggestion → server stamps pricePaidSuggestionDismissedAt
  dismissPriceSuggestion: z.boolean().optional(),
  // Manual HLTB data entry (null to clear)
  hltbMain: z.number().min(0).max(10000).nullable().optional(),
  hltbMainExtra: z.number().min(0).max(10000).nullable().optional(),
  hltbCompletionist: z.number().min(0).max(10000).nullable().optional(),
  // Exclude game from HLTB sync entirely (true = stop looking, false = resume sync)
  hltbExcluded: z.boolean().optional(),
  // Which playtime basis feeds $/hour scoring for this game
  playtimeSource: z.enum(['hltb', 'steam_reviews']).optional(),
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

/**
 * Setting keys whose values are secrets — never echo these back to the client
 * (not via the API, not serialized into page HTML as client-component props).
 * `steam_user_id` is deliberately excluded: a Steam64 ID is public.
 */
export const SECRET_SETTING_KEYS = [
  'steam_api_key',
  'itad_api_key',
  'discord_webhook_url',
  'discord_ops_webhook_url',
] as const;

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

// Acceptable range for maxDollarsPerHour threshold values.
// A zero or negative threshold causes divide-by-zero in the value-received
// scoring engine (pricePaid / 0 = Infinity), so we enforce a tight positive floor.
const DPH_MIN = 0.01;
const DPH_MAX = 100;

// Shape of the scoring_thresholds JSON blob — each per-tier $/hr value must be a
// finite positive number within DPH_MIN..DPH_MAX.  Partial blobs are fine; they
// are deep-merged over DEFAULT_THRESHOLDS when read back.
const scoringThresholdsSchema = z.object({
  maxDollarsPerHour: z.object({
    overwhelminglyPositive: z.number().finite().min(DPH_MIN).max(DPH_MAX),
    veryPositive: z.number().finite().min(DPH_MIN).max(DPH_MAX),
    positive: z.number().finite().min(DPH_MIN).max(DPH_MAX),
    mixed: z.number().finite().min(DPH_MIN).max(DPH_MAX),
    negative: z.number().finite().min(DPH_MIN).max(DPH_MAX),
  }).partial().optional(),
}).optional();

// Shape of the scoring_weights JSON blob — each weight must be a finite number
// in [0, 1]. Partial blobs are merged over DEFAULT_WEIGHTS.
const scoringWeightsSchema = z.object({
  priceWeight: z.number().finite().min(0).max(1).optional(),
  reviewWeight: z.number().finite().min(0).max(1).optional(),
  valueWeight: z.number().finite().min(0).max(1).optional(),
  interestWeight: z.number().finite().min(0).max(1).optional(),
}).optional();

// Shape of the notification_preferences JSON blob. Sections are optional (the
// getter deep-merges over defaults), but any present value is range-checked.
const notificationPreferencesSchema = z.object({
  categories: z
    .record(z.string(), z.object({ inApp: z.boolean(), discord: z.boolean() }))
    .optional(),
  frequency: z
    .object({
      // Both optional — the getter deep-merges any present value over defaults, so a
      // partial frequency blob (e.g. only digestHour) is valid.
      throttleHours: z.number().int().min(1).max(168).optional(),
      digestHour: z.number().int().min(0).max(23).optional(),
    })
    .optional(),
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

  // Each JSON-blob key validates independently: a parse failure for one key
  // adds its own issue but must NOT short-circuit validation of the others, so a
  // multi-error payload surfaces every problem in one response. `parsed` stays
  // `undefined` on parse failure, which skips that key's range-check below
  // (JSON.parse never legitimately yields `undefined`).
  const thresholdsRaw = data.settings['scoring_thresholds'];
  if (thresholdsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(thresholdsRaw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', 'scoring_thresholds'], message: 'Invalid JSON' });
    }
    if (parsed !== undefined && !scoringThresholdsSchema.safeParse(parsed).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', 'scoring_thresholds'],
        message: `maxDollarsPerHour values must be finite numbers between ${DPH_MIN} and ${DPH_MAX}`,
      });
    }
  }

  const weightsRaw = data.settings['scoring_weights'];
  if (weightsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(weightsRaw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', 'scoring_weights'], message: 'Invalid JSON' });
    }
    if (parsed !== undefined && !scoringWeightsSchema.safeParse(parsed).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings', 'scoring_weights'],
        message: 'Weight values must be finite numbers between 0 and 1',
      });
    }
  }

  const prefsRaw = data.settings['notification_preferences'];
  if (prefsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(prefsRaw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', 'notification_preferences'], message: 'Invalid JSON' });
    }
    if (parsed !== undefined && !notificationPreferencesSchema.safeParse(parsed).success) {
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
