/**
 * Notification delivery preferences.
 *
 * Controls how each category of notification is routed across channels
 * (in-app bell + Discord), how often per-game alerts may repeat, and a
 * nightly quiet-hours window that pauses Discord pings.
 *
 * Stored as a single JSON blob under the `notification_preferences` setting
 * key; read via getNotificationPreferences() in db/queries.ts (defaults +
 * deep-merge, mirroring getScoringConfig). Pure data model — no DB access here.
 */

export type NotificationCategory =
  | 'deal-individual' // free / threshold hit / genuinely new ATL — high signal
  | 'deal-digest' // still-at-ATL roundup — batched, lower signal
  | 'release' // game launch + early-access graduation
  | 'milestone' // onboarding milestones
  | 'system'; // sync-health, backup failure, ops

/** Stable order for iterating categories in the UI and when merging defaults. */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'deal-individual',
  'deal-digest',
  'release',
  'milestone',
  'system',
];

export interface ChannelRouting {
  inApp: boolean;
  discord: boolean;
}

export interface NotificationPreferences {
  /** Per-category channel routing. */
  categories: Record<NotificationCategory, ChannelRouting>;
  frequency: {
    /** Minimum hours between notifications for the same game (1–168). */
    throttleHours: number;
  };
  quietHours: {
    enabled: boolean;
    /** Local hour the window opens (0–23). */
    start: number;
    /** Local hour the window closes (0–23). */
    end: number;
  };
}

export const DEFAULT_THROTTLE_HOURS = 24;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  categories: {
    'deal-individual': { inApp: true, discord: true },
    'deal-digest': { inApp: true, discord: true },
    release: { inApp: true, discord: true },
    milestone: { inApp: true, discord: true },
    system: { inApp: true, discord: true },
  },
  frequency: { throttleHours: DEFAULT_THROTTLE_HOURS },
  quietHours: { enabled: false, start: 22, end: 8 },
};

/**
 * True if `hour` (0–23, local) falls within the quiet-hours window.
 * Handles wrap-around windows (e.g. 22 → 8 spans midnight). A window where
 * start === end is treated as empty (never quiet). Pure — caller supplies the
 * current hour so this stays testable and free of `new Date()`.
 */
export function isWithinQuietHours(
  quietHours: NotificationPreferences['quietHours'],
  hour: number,
): boolean {
  if (!quietHours.enabled) return false;
  const { start, end } = quietHours;
  if (start === end) return false;
  if (start < end) {
    // Same-day window, e.g. 8 → 22
    return hour >= start && hour < end;
  }
  // Wrap-around window, e.g. 22 → 8 (next day)
  return hour >= start || hour < end;
}
