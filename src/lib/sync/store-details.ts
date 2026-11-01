/**
 * Persist the store-page details from a Steam appdetails response: description,
 * developer, publisher, co-op and multiplayer flags, genre and category tags.
 * Shared by the daily metadata refresh and the manual refresh. Writes no
 * freshness timestamp: review freshness is stamped only by a review write.
 */

import { updateGameStoreDetails, upsertTags } from '../db/queries';
import type { SteamAppDetails } from '../steam/types';

export function saveStoreDetails(gameId: number, details: NonNullable<SteamAppDetails['data']>): void {
  const categories = details.categories ?? [];
  updateGameStoreDetails(gameId, {
    description: details.short_description || undefined,
    developer: details.developers?.[0] || undefined,
    publisher: details.publishers?.[0] || undefined,
    isCoop: categories.some((c) => c.description.toLowerCase().includes('co-op')),
    isMultiplayer: categories.some((c) => {
      const d = c.description.toLowerCase();
      return d.includes('multi-player') || d.includes('multiplayer');
    }),
  });
  if (details.genres?.length) upsertTags(gameId, details.genres.map((g) => g.description), 'genre');
  if (categories.length) upsertTags(gameId, categories.map((c) => c.description), 'category');
}
