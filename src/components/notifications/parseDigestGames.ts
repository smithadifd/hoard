/** One game inside a "still at all-time low" digest notification. */
export interface DealDigestGame {
  gameId: number;
  title: string;
  currentPrice: number;
  discountPercent: number;
  store: string;
  storeUrl?: string | null;
}

/**
 * Pull the games array out of a digest notification's metadata, validating each
 * entry. Returns an empty array for anything that isn't a recognizable digest, so
 * callers can use a non-empty result both to detect a digest and to render it.
 */
export function parseDigestGames(metadata: Record<string, unknown> | null): DealDigestGame[] {
  if (!metadata || !Array.isArray(metadata.games)) return [];
  const games: DealDigestGame[] = [];
  for (const raw of metadata.games) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.gameId !== 'number' || typeof g.title !== 'string') continue;
    games.push({
      gameId: g.gameId,
      title: g.title,
      currentPrice: typeof g.currentPrice === 'number' ? g.currentPrice : 0,
      discountPercent: typeof g.discountPercent === 'number' ? g.discountPercent : 0,
      store: typeof g.store === 'string' ? g.store : '',
      storeUrl: typeof g.storeUrl === 'string' ? g.storeUrl : null,
    });
  }
  return games;
}
