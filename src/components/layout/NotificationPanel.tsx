'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, PauseCircle, Sparkles, Trash2, Inbox, X, Tag, Rocket } from 'lucide-react';
import type { NotificationRow, NotificationType } from '@/lib/notifications/types';

interface NotificationPanelProps {
  notifications: NotificationRow[];
  loading: boolean;
  onDismiss: (id: number) => void;
  onDismissAll: () => void;
  onClose: () => void;
}

const TYPE_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  'drain-complete': CheckCircle2,
  'drain-paused': PauseCircle,
  'sync-failure': AlertTriangle,
  'triage-nudge': Sparkles,
  milestone: Sparkles,
  'deal-alert': Tag,
  release: Rocket,
  system: AlertTriangle,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  'drain-complete': 'text-emerald-500',
  'drain-paused': 'text-amber-500',
  'sync-failure': 'text-destructive',
  'triage-nudge': 'text-primary',
  milestone: 'text-primary',
  'deal-alert': 'text-deal-great',
  release: 'text-blue-500',
  system: 'text-amber-500',
};

function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationPanel({
  notifications,
  loading,
  onDismiss,
  onDismissAll,
  onClose,
}: NotificationPanelProps) {
  return (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border border-white/[0.08] bg-surface-high/95 backdrop-blur-xl shadow-xl shadow-black/40 z-50">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="text-xs font-label font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Notifications
        </span>
        <div className="flex items-center gap-1">
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="Dismiss all"
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent transition-colors"
            aria-label="Close notifications"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">No notifications</p>
            <p className="text-xs">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onDismiss={onDismiss}
                onClose={onClose}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotificationItem({
  notification: n,
  onDismiss,
  onClose,
}: {
  notification: NotificationRow;
  onDismiss: (id: number) => void;
  onClose: () => void;
}) {
  const Icon = TYPE_ICONS[n.type] ?? Sparkles;
  const color = TYPE_COLORS[n.type] ?? 'text-primary';

  const body = (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <span className={`mt-0.5 shrink-0 ${color}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{n.title}</p>
        {n.body && <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{n.body}</p>}
        <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {formatRelative(n.createdAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(n.id);
        }}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );

  return (
    <li className="border-b border-white/[0.04] last:border-b-0">
      {n.link ? (
        <Link href={n.link} onClick={onClose} className="block hover:bg-accent/50 transition-colors">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
