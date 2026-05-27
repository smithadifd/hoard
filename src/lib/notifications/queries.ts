/**
 * Notification read/mutate queries.
 *
 * Used by API routes (/api/notifications, /api/notifications/[id],
 * /api/notifications/unread-count) and the daily prune cron.
 */

import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications } from '@/lib/db/schema';
import type { NotificationRow, NotificationType } from './types';

const DEFAULT_LIMIT = 20;

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hydrate(row: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    link: row.link,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
    readAt:
      row.readAt instanceof Date
        ? row.readAt.getTime()
        : row.readAt === null
          ? null
          : Number(row.readAt),
    dismissedAt:
      row.dismissedAt instanceof Date
        ? row.dismissedAt.getTime()
        : row.dismissedAt === null
          ? null
          : Number(row.dismissedAt),
  };
}

/**
 * Most recent `limit` notifications for the user, excluding dismissed.
 * Sorted newest-first.
 */
export function listNotifications(
  userId: string,
  limit: number = DEFAULT_LIMIT,
): NotificationRow[] {
  const db = getDb();
  const rows = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
  return rows.map(hydrate);
}

/** Cheap polling endpoint backing the bell badge. */
export function getUnreadCount(userId: string): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
      ),
    )
    .get();
  return Number(row?.count ?? 0);
}

/** Marks every unread (and non-dismissed) notification read. Used when the panel opens. */
export function markAllRead(userId: string): number {
  const db = getDb();
  const result = db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
      ),
    )
    .run();
  return result.changes;
}

export function markRead(id: number, userId: string): boolean {
  const db = getDb();
  const result = db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function dismissNotification(id: number, userId: string): boolean {
  const db = getDb();
  const result = db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        isNull(notifications.dismissedAt),
      ),
    )
    .run();
  return result.changes > 0;
}

/** Dismisses every still-visible notification for the user. */
export function dismissAll(userId: string): number {
  const db = getDb();
  const result = db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
    .run();
  return result.changes;
}

/**
 * Retention sweep.
 *  - Dismissed > 7 days → delete
 *  - Older than 60 days and not dismissed → delete (covers both read and
 *    unread stale rows; without this read-but-never-dismissed rows would grow
 *    unbounded)
 *
 * Returns the number of rows removed. Called by the `notification-prune` cron.
 */
export function pruneNotifications(now: Date = new Date()): number {
  const db = getDb();
  const dismissedCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const ageCutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // `lt(dismissedAt, cutoff)` naturally excludes NULLs — SQLite returns NULL
  // (not true) for `NULL < anything`, so non-dismissed rows are skipped here.
  const dismissedDeleted = db
    .delete(notifications)
    .where(lt(notifications.dismissedAt, dismissedCutoff))
    .run();

  // Cull stale rows the user neither dismissed nor returned to. Match on
  // `isNull(dismissedAt)` so we don't double-count rows the previous delete
  // already removed.
  const staleDeleted = db
    .delete(notifications)
    .where(and(isNull(notifications.dismissedAt), lt(notifications.createdAt, ageCutoff)))
    .run();

  return dismissedDeleted.changes + staleDeleted.changes;
}
