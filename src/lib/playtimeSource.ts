/**
 * Client-safe constants/types for the playtime-source feature. Kept out of
 * db/queries.ts so 'use client' components (triage cards, toggles) can import
 * them without pulling server-only DB code into the browser bundle.
 */

/** Which playtime basis feeds the $/hour value component, per game. */
export type PlaytimeSource = 'hltb' | 'steam_reviews';

/**
 * After this many consecutive failed/too-small review samples, stop retrying so
 * we don't pound the Steam reviews endpoint for games that never yield a usable
 * sample. Mirrors the HLTB give-up policy.
 */
export const STEAM_PLAYTIME_GIVE_UP_MISSES = 3;
