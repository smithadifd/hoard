/**
 * Net-new owned-add price fetch (price-paid capture, part 2)
 *
 * When a game is added straight to the library as owned and was NEVER on the
 * wishlist/watchlist, it has no ITAD id resolved and no price snapshot — so the
 * price-paid nudge (part 3) has nothing to estimate from. This module invests in
 * coverage for exactly that lane: resolve the ITAD id (if missing) and fetch one
 * current overview so a snapshot exists to power the suggestion.
 *
 * Scoped deliberately narrow (Andrew's product call): only net-new adds going
 * forward from account creation, never a bulk historical backfill. The initial
 * library import is handled by the onboarding drain, not here.
 *
 * Honest boundary: we only ever store a real ITAD price. A game we can't resolve,
 * or that ITAD returns no/foreign-currency price for, simply gets no snapshot —
 * the nudge then stays silent rather than fabricating a number.
 */

import { getEffectiveConfig } from '../config';
import { getITADClient } from '../itad/client';
import { calculateDealScore } from '../scoring/engine';
import {
  getGamesByIdsForPriceFetch,
  bulkUpdateGameItadIds,
  insertPriceSnapshot,
  getScoringConfig,
} from '../db/queries';
import { BASE_CURRENCY } from './types';

/**
 * Resolve ITAD ids + fetch one current price overview for the given game ids,
 * inserting a snapshot per game that returns a real USD price. Returns the count
 * of snapshots written. Self-contained and best-effort: any upstream failure is
 * logged and skipped — this must never fail the library sync that calls it.
 */
export async function fetchNetNewPrices(gameIds: number[]): Promise<{ snapshotted: number }> {
  if (gameIds.length === 0) return { snapshotted: 0 };

  const config = getEffectiveConfig();
  if (!config.itadApiKey) {
    // No ITAD key configured — nothing to fetch. The nudge stays silent (honest).
    return { snapshotted: 0 };
  }

  const gamesToFetch = getGamesByIdsForPriceFetch(gameIds);
  if (gamesToFetch.length === 0) return { snapshotted: 0 };

  const client = getITADClient();

  // Step 1: resolve any missing ITAD ids and persist them.
  const needLookup = gamesToFetch.filter((g) => !g.itadGameId);
  if (needLookup.length > 0) {
    const resolved = await client.lookupBySteamAppIds(needLookup.map((g) => g.steamAppId));
    const updates: Array<{ steamAppId: number; itadGameId: string }> = [];
    for (const [steamAppId, itadGameId] of resolved) {
      updates.push({ steamAppId, itadGameId });
      const game = gamesToFetch.find((g) => g.steamAppId === steamAppId);
      if (game) game.itadGameId = itadGameId;
    }
    if (updates.length > 0) bulkUpdateGameItadIds(updates);
  }

  // Step 2: map resolvable ITAD id → game record.
  const itadToGame = new Map<string, (typeof gamesToFetch)[number]>();
  for (const game of gamesToFetch) {
    if (game.itadGameId) itadToGame.set(game.itadGameId, game);
  }
  if (itadToGame.size === 0) return { snapshotted: 0 };

  // Step 3: fetch overviews and snapshot each priced game. Same BASE_CURRENCY
  // guards as the main price sync — never chart a foreign-currency amount as USD.
  const overviews = await client.getOverview([...itadToGame.keys()]);
  let snapshotted = 0;

  for (const overview of overviews) {
    const game = itadToGame.get(overview.id);
    if (!game) continue;

    const current = overview.current;
    const lowest = overview.lowest;
    const currentPrice = current?.price?.amount;
    const regularPrice = current?.regular?.amount;
    const cut = current?.cut ?? 0;
    const currency = current?.price?.currency ?? BASE_CURRENCY;
    const storeName = current?.shop?.name;
    const historicalLowPrice =
      lowest?.price?.currency === BASE_CURRENCY ? lowest.price.amount : undefined;

    if (currentPrice === undefined || regularPrice === undefined) continue;
    if (currency !== BASE_CURRENCY) continue;

    const isAtATL = historicalLowPrice !== undefined && currentPrice <= historicalLowPrice;

    let dealScoreValue: number | undefined;
    try {
      const { weights, thresholds } = getScoringConfig();
      dealScoreValue = calculateDealScore(
        {
          currentPrice,
          regularPrice,
          historicalLow: historicalLowPrice ?? currentPrice,
          reviewPercent: game.reviewScore,
          hltbMainHours: game.hltbMain,
          personalInterest: game.personalInterest ?? 3,
        },
        weights,
        thresholds,
      ).overall;
    } catch {
      // Score computation failed — snapshot without a score.
    }

    try {
      insertPriceSnapshot({
        gameId: game.id,
        store: storeName ?? 'Best Price',
        priceCurrent: currentPrice,
        priceRegular: regularPrice,
        discountPercent: cut,
        currency,
        url: current?.url ?? overview.urls?.game,
        isHistoricalLow: isAtATL,
        historicalLowPrice,
        dealScore: dealScoreValue,
      });
      snapshotted++;
    } catch (error) {
      console.error(`[NetNewPrices] Failed to snapshot "${game.title}" (${game.id}):`, error);
    }
  }

  return { snapshotted };
}
