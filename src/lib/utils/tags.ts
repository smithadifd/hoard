/**
 * Tag curation for display.
 *
 * The only non-genre tags Hoard stores come from Steam's appdetails
 * `categories` array (synced in `src/lib/sync/reviews.ts`). That array is
 * dominated by platform/feature plumbing — "Steam Cloud", "Family Sharing",
 * "Full controller support", "Steam Trading Cards", "Custom Volume Controls",
 * "Captions available", "Remote Play on TV", etc. — plus localized duplicates
 * from non-English appdetails responses. Surfacing all of them buries the few
 * categories that actually inform a decision (how a game is played).
 *
 * We curate down to an allowlist of decision-relevant play-mode categories.
 * An allowlist (vs. a denylist) is deliberate: Steam adds new feature flags
 * regularly and returns localized variants, so enumerating junk is a losing
 * game — enumerating the small set of useful categories is stable.
 *
 * Note: this shapes the *display* `tags` array only. Tag-based DB filtering
 * (genre filter, excludeTags) reads the raw `game_tags` table directly and is
 * unaffected — see `src/lib/db/queries.ts`.
 */

/**
 * Steam category names worth surfacing, lower-cased for matching. These
 * describe how a game is played (solo/co-op/PvP/VR/etc.) rather than store or
 * client feature flags.
 */
const USEFUL_CATEGORY_TAGS = new Set<string>([
  'single-player',
  'multi-player',
  'co-op',
  'online co-op',
  'lan co-op',
  'shared/split screen',
  'shared/split screen co-op',
  'shared/split screen pvp',
  'pvp',
  'online pvp',
  'lan pvp',
  'cross-platform multiplayer',
  'mmo',
  'vr supported',
  'vr support',
  'vr only',
  'includes level editor',
  'steam workshop',
]);

/**
 * Filter a game's non-genre tags down to the decision-relevant subset, drop
 * duplicates, and preserve input order. Returns useful play-mode categories
 * only; junk feature flags and localized variants are removed.
 */
export function curateDisplayTags(tagNames: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of tagNames) {
    const key = name.toLowerCase();
    if (!USEFUL_CATEGORY_TAGS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
