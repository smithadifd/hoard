'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { NotificationPanel } from './NotificationPanel';
import type { NotificationRow } from '@/lib/notifications/types';

const UNREAD_POLL_MS = 30_000;

interface ApiSuccess<T> { data: T }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    const body = (await res.json()) as ApiSuccess<T>;
    return body.data;
  } catch {
    return null;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss (matches UserMenu pattern)
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Poll unread count every 30s, plus on mount and tab visibility return.
  // Inlining the tick keeps `useEffect`'s set-state-in-effect rule happy —
  // the state update only happens after the awaited fetch resolves.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const data = await fetchJson<{ count: number }>('/api/notifications/unread-count');
      if (cancelled || !data) return;
      setUnread(data.count);
    };
    void tick();
    const interval = setInterval(tick, UNREAD_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    const data = await fetchJson<{ notifications: NotificationRow[] }>('/api/notifications');
    setNotifications(data?.notifications ?? []);
    setLoading(false);

    // Mark all read on open — keeps the badge in sync with what the user has seen.
    if (unread > 0) {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-all-read' }),
      }).catch(() => {});
      setUnread(0);
    }
  }, [unread]);

  const handleDismiss = useCallback(async (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    }).catch(() => {});
  }, []);

  const handleDismissAll = useCallback(async () => {
    setNotifications([]);
    await fetch('/api/notifications', { method: 'DELETE' }).catch(() => {});
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleOpen}
        className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-accent transition-colors"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unread > 0 && (
          <span
            className="absolute top-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <NotificationPanel
          notifications={notifications}
          loading={loading}
          onDismiss={handleDismiss}
          onDismissAll={handleDismissAll}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
