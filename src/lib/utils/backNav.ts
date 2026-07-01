/**
 * Back-navigation origin tracking for the game detail page.
 *
 * Lists (library, wishlist, backlog, …) link to a game's detail page with a
 * `?from=<origin>` query param so the detail page's back link can return the
 * user to the list they came from instead of always sending them to /library.
 *
 * Only a fixed allow-list of origins is honored; anything unknown (or a direct
 * hard-load with no param) falls back to the Library — the original behavior.
 */

export type GameDetailOrigin = 'library' | 'wishlist' | 'backlog' | 'deals' | 'releases';

interface BackTarget {
  /** Route to return to. */
  href: string;
  /** Label rendered on the back link, e.g. "Back to Wishlist". */
  label: string;
}

const ORIGINS: Record<GameDetailOrigin, BackTarget> = {
  library: { href: '/library', label: 'Back to Library' },
  wishlist: { href: '/wishlist', label: 'Back to Wishlist' },
  backlog: { href: '/backlog', label: 'Back to Backlog' },
  deals: { href: '/deals', label: 'Back to Deals' },
  releases: { href: '/releases', label: 'Back to Releases' },
};

const DEFAULT_BACK_TARGET: BackTarget = ORIGINS.library;

/**
 * Resolve the back-link target for a game detail page from its `from` query
 * param. Unknown or missing origins fall back to the Library.
 */
export function resolveBackTarget(from: string | undefined): BackTarget {
  if (from && from in ORIGINS) {
    return ORIGINS[from as GameDetailOrigin];
  }
  return DEFAULT_BACK_TARGET;
}

/**
 * Build a game detail href, carrying the origin list as a `?from=` param so the
 * detail page can offer a "Back to <origin>" link. Pass no origin to link
 * without one (detail page then defaults to Library).
 */
export function gameDetailHref(gameId: number, from?: GameDetailOrigin): string {
  return from ? `/games/${gameId}?from=${from}` : `/games/${gameId}`;
}
