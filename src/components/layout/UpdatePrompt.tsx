'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const POLL_INTERVAL_MS = 60_000;

async function nukeCachesAndSW(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Best-effort — fall through to reload regardless.
  }
}

/**
 * UpdatePrompt — polls /api/version and prompts the user to reload when the
 * server's build ID has changed. The reload button unregisters all service
 * workers and clears caches before reloading, so a stuck SW from a previous
 * deploy can never wedge a user on stale code.
 */
export function UpdatePrompt() {
  const initialBuildId = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId?: string };
        if (cancelled || !buildId) return;
        if (initialBuildId.current === null) {
          initialBuildId.current = buildId;
        } else if (buildId !== initialBuildId.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // Network hiccup — don't trigger a banner, just retry next interval.
      }
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!updateAvailable) return null;

  const handleReload = async () => {
    await nukeCachesAndSW();
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs text-primary bg-primary/10 border-b border-primary/20">
      <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="flex-1">A new version of Hoard is available.</span>
      <button
        onClick={handleReload}
        className="px-2 py-0.5 rounded bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
      >
        Reload
      </button>
    </div>
  );
}
