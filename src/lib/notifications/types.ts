/**
 * Notification type taxonomy.
 *
 * Add a new variant here when introducing a new notification kind, and update
 * the union literal in `notifications.type` SQL comment in schema.ts to match.
 */
export type NotificationType =
  | 'drain-complete'
  | 'drain-paused'
  | 'sync-failure'
  | 'triage-nudge'
  | 'milestone';

export interface NotificationPayload {
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationRow {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number; // epoch ms
  readAt: number | null;
  dismissedAt: number | null;
}
