'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import {
  SCROLL_CONTAINER_ID,
  isGameDetailPath,
  getPreviousPathname,
} from './scrollRestorationTracking';

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

    const cameFromGameDetail = isGameDetailPath(getPreviousPathname());
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
