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
