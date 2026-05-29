/**
 * Unified notification dispatch.
 *
 * Every outbound notification flows through emitNotification(). It reads the
 * user's delivery preferences and, for the event's category, fans out to each
 * enabled channel: the in-app bell (createNotification) and Discord (a thunk
 * the caller supplies wrapping the right client function). Per-channel failures
 * are isolated — one channel throwing never affects the other, and
 * emitNotification itself never throws.
 *
 * Quiet hours pause *Discord* only; the in-app bell always records (it's silent
 * by nature), so nothing is lost during the window. The returned
 * DispatchResult lets callers (e.g. the price-alert throttle) know whether
 * *any* channel delivered.
 *
 * Server-side only.
 */
import { getNotificationPreferences, getFirstUserId } from '@/lib/db/queries';
import { createNotification } from './create';
import { categoryToInAppType, type NotificationCategory } from './categories';
import { DEFAULT_PREFERENCES, isWithinQuietHours, type NotificationPreferences } from './preferences';
import type { NotificationPayload } from './types';

export interface NotificationEvent {
  category: NotificationCategory;
  /** Explicit recipient when known (deal alerts, milestones). Falls back to the first user. */
  userId?: string;
  /**
   * In-app payload. For a digest this is a single summary payload, not one per
   * game. Omit for events with no in-app representation (e.g. a drain-progress
   * milestone whose in-app row is owned elsewhere) — those stay Discord-only.
   */
  inApp?: NotificationPayload;
  /** Thunk wrapping the Discord client call. Resolves true when a message was sent. */
  discord: () => Promise<boolean>;
}

export interface DispatchResult {
  inAppDelivered: boolean;
  discordDelivered: boolean;
}

/**
 * Categories that quiet hours suppresses on Discord. Only the high-frequency
 * deal pings are gated — milestones (fired-once, idempotent) and system/ops
 * alerts always deliver, so a nightly window never silently drops them.
 */
const QUIET_HOURS_CATEGORIES = new Set<NotificationCategory>(['deal-individual', 'deal-digest']);

export async function emitNotification(event: NotificationEvent): Promise<DispatchResult> {
  const result: DispatchResult = { inAppDelivered: false, discordDelivered: false };

  let prefs: NotificationPreferences;
  try {
    prefs = getNotificationPreferences();
  } catch {
    // DB not ready — fall back to defaults so first-run behavior still notifies.
    prefs = DEFAULT_PREFERENCES;
  }
  const routing = prefs.categories[event.category];
  const quiet =
    QUIET_HOURS_CATEGORIES.has(event.category) &&
    isWithinQuietHours(prefs.quietHours, new Date().getHours());

  // In-app channel — recorded even during quiet hours (it's silent, just a badge).
  if (event.inApp && routing.inApp) {
    try {
      const userId = event.userId ?? getFirstUserId();
      const id = createNotification(userId, categoryToInAppType(event.category), event.inApp);
      result.inAppDelivered = id !== null;
    } catch (err) {
      // getFirstUserId() throws before setup; createNotification itself never throws.
      console.error('[Notifications] In-app dispatch skipped:', err);
    }
  }

  // Discord channel — suppressed during quiet hours.
  if (routing.discord && !quiet) {
    try {
      result.discordDelivered = await event.discord();
    } catch (err) {
      console.error('[Notifications] Discord dispatch failed:', err);
    }
  }

  return result;
}
