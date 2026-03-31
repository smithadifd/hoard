'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

export function useScrollRestoration() {
  const pathname = usePathname();
  const key = `scroll:${pathname}`;
  const didRestore = useRef(false);

  // Restore scroll on mount (only if navigating back)
  useEffect(() => {
    if (didRestore.current) return;
    const saved = sessionStorage.getItem(key);
    if (saved !== null) {
      const y = parseInt(saved, 10);
      // Defer to allow DOM to paint first
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      });
    }
    didRestore.current = true;
  }, [key]);

  // Save scroll on unload / navigation
  useEffect(() => {
    const save = () => {
      sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    };
    window.addEventListener('pagehide', save);
    return () => {
      save(); // Also save on React unmount (client-side navigation)
      window.removeEventListener('pagehide', save);
    };
  }, [key]);
}
