'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The id of the app's single scrollable element — `<main>` in LayoutShell.
 * The app shell pins the viewport (`h-screen overflow-hidden`) and scrolls this
 * container instead of the window, so scroll restoration must target it rather
 * than `window`.
 */
export const SCROLL_CONTAINER_ID = 'app-scroll-container';

/**
 * Pathname of the previously-rendered route, updated on every client-side
 * navigation by {@link trackPreviousPathname} (called from LayoutShell).
 *
 * Module-level so it survives SPA navigation but resets on a full page reload —
 * exactly the desired semantics: a fresh entry (hard load, external link, or
 * arriving from an unrelated page) should start at the top, not at a stale
 * saved offset.
 */
let previousPathname: string | null = null;
let currentPathname: string | null = null;

const GAME_DETAIL_PATTERN = /^\/games\/[^/]+$/;

export function isGameDetailPath(path: string | null): boolean {
  return path !== null && GAME_DETAIL_PATTERN.test(path);
}

/**
 * Records route transitions so a list view can tell whether the user arrived
 * back from a game detail page. Call once, from a client component that renders
 * on every route (LayoutShell).
 */
export function trackPreviousPathname(pathname: string): void {
  if (pathname === currentPathname) return;
  previousPathname = currentPathname;
  currentPathname = pathname;
}

/** The route the user was on before the current one (null on fresh load). */
export function getPreviousPathname(): string | null {
  return previousPathname;
}

/** Test-only: clear the module-level route-tracking state. */
export function __resetScrollRestorationTracking(): void {
  previousPathname = null;
  currentPathname = null;
}

function getScrollContainer(): HTMLElement | null {
  return document.getElementById(SCROLL_CONTAINER_ID);
}

/**
 * Remembers and restores the scroll position of a list route.
 *
 * The saved position is only restored when the user arrives back on the list
 * from a game detail page (e.g. clicked into a game, then navigated back).
 * Entering the list from anywhere else clears the stale position and starts at
 * the top.
 */
export function useScrollRestoration() {
  const pathname = usePathname();
  const key = `scroll:${pathname}`;
  const didRestore = useRef(false);

  // Restore scroll on mount — but only when returning from a game detail.
  useEffect(() => {
    if (didRestore.current) return;
    didRestore.current = true;

    const cameFromGameDetail = isGameDetailPath(previousPathname);
    const saved = sessionStorage.getItem(key);

    if (cameFromGameDetail && saved !== null) {
      const y = parseInt(saved, 10);
      // Defer to allow the list to paint first.
      requestAnimationFrame(() => {
        getScrollContainer()?.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      });
    } else {
      // Fresh entry from an unrelated route — drop the stale position.
      sessionStorage.removeItem(key);
    }
  }, [key]);

  // Persist scroll position on unload and on client-side navigation away.
  useEffect(() => {
    const save = () => {
      const container = getScrollContainer();
      if (container) {
        sessionStorage.setItem(key, String(Math.round(container.scrollTop)));
      }
    };
    window.addEventListener('pagehide', save);
    return () => {
      save(); // Also save on React unmount (client-side navigation)
      window.removeEventListener('pagehide', save);
    };
  }, [key]);
}
