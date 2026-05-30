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
  | 'milestone'
  | 'deal-alert' // price alert: free / threshold / new ATL, and the still-at-ATL digest
  | 'release' // game launch + early-access graduation
  | 'price-paid-suggestion' // owned-game: confirm what you paid
  | 'system'; // sync-health, backup failure, and other ops alerts

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
