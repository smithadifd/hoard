/**
 * Notification creation helper.
 *
 * Server-side only. Called from drain orchestrator milestones, health checks,
 * and other backend triggers. Per-user; never throws — failing to write a
 * notification should never break the work that fired it.
 */

import { getDb } from '@/lib/db';
import { notifications } from '@/lib/db/schema';
import type { NotificationPayload, NotificationType } from './types';

export function createNotification(
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): number | null {
  try {
    const db = getDb();
    const row = db
      .insert(notifications)
      .values({
        userId,
        type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
        createdAt: new Date(),
      })
      .returning({ id: notifications.id })
      .get();
    return row?.id ?? null;
  } catch (err) {
    console.error(`[Notifications] Failed to create ${type} notification:`, err);
    return null;
  }
}
