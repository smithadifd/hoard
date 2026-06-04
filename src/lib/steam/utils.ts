/**
 * Steam Early Access genre id. Source: appdetails `genres` array.
 *
 * Early Access is a *genre* (id "70", description "Early Access"), NOT a
 * category. Steam's `categories` array also has an id 70 — but there it means
 * "Surround Sound", a common feature flag on released games. Deriving EA from
 * categories therefore false-flags any game with surround sound and misses
 * every genuine EA title, so we read it from `genres` instead.
 *
 * Note ids are strings in `genres` and numbers in `categories`.
 * https://partner.steamgames.com/doc/store/getreviews (genres documented under appdetails)
 */
const EARLY_ACCESS_GENRE_ID = '70';

export function isEarlyAccessFromGenres(
  genres: Array<{ id: string }> | undefined,
): boolean {
  return !!genres?.some((g) => g.id === EARLY_ACCESS_GENRE_ID);
}
