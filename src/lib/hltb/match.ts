/**
 * HLTB title-matching helpers.
 *
 * Pure functions used to clean/normalize Steam game titles before searching
 * HowLongToBeat, and to score how well a candidate result matches the search
 * title. Extracted out of `client.ts` (plan-28 step 5.3) so this fragile,
 * regex-heavy matching logic is unit-testable without mocking the network.
 */

export function cleanSearchTitle(title: string): string {
  return title
    .replace(/[™®©]/g, '')                 // Strip trademark/copyright symbols
    .replace(/[^\p{L}\p{N}_\s'-]/gu, ' ')    // Replace other special chars with space (keep letters/digits in any script, underscore, apostrophes, hyphens within words)
    .replace(/\s+/g, ' ')                  // Normalize whitespace
    .trim();
}

/**
 * Strip common Steam edition suffixes and parenthetical years to produce
 * a simplified title more likely to match HLTB's catalog.
 *
 * Examples:
 *   "The Elder Scrolls IV: Oblivion Game of the Year Edition (2009)" → "The Elder Scrolls IV: Oblivion"
 *   "Grand Theft Auto V Legacy" → "Grand Theft Auto V"
 *   "Star Wars: Battlefront 2 (Classic, 2005)" → "Star Wars: Battlefront 2"
 */
export function normalizeGameTitle(title: string): string {
  let normalized = title;

  // Strip parenthetical content containing years: (2005), (Classic, 2005), (1999)
  normalized = normalized.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '');

  // Strip common edition/version suffixes (case-insensitive)
  const editionPattern = /\s*[-–—:]?\s*\b(Game of the Year|GOTY|Enhanced|Deluxe|Ultimate|Complete|Definitive|Special|Legendary|Premium|Gold|Standard|Steam|Maximum|HD|Remastered|Remaster|Anniversary|Director'?s\s*Cut|Digital)\s*(Edition|Version)?\s*$/i;
  normalized = normalized.replace(editionPattern, '');

  // Strip trailing "Legacy"
  normalized = normalized.replace(/\s+Legacy\s*$/i, '');

  return normalized.trim();
}

/**
 * Compute string similarity (SequenceMatcher-like ratio).
 */
export function similarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;
  if (!al || !bl) return 0;

  // Simple character-overlap ratio (good enough for game title matching)
  const longer = al.length >= bl.length ? al : bl;
  const shorter = al.length < bl.length ? al : bl;

  let matches = 0;
  const longerChars = [...longer];
  for (const ch of shorter) {
    const idx = longerChars.indexOf(ch);
    if (idx !== -1) {
      longerChars.splice(idx, 1);
      matches++;
    }
  }
  return (2.0 * matches) / (al.length + bl.length);
}
