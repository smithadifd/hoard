/**
 * ITAD Price Sync
 *
 * Fetches current prices and historical lows from IsThereAnyDeal
 * for all wishlisted and watchlisted games. Stores results as
 * price snapshots in the database for trend tracking.
 */

import { getEffectiveConfig } from '../config';
import { getITADClient } from '../itad/client';
import { calculateDealScore } from '../scoring/engine';
import {
  getGamesForPriceSync,
  bulkUpdateGameItadIds,
  insertPriceSnapshot,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  getScoringConfig,
} from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';
import { SUCCESS_RATE_THRESHOLDS } from './health';

export async function syncPrices(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const config = getEffectiveConfig();
  const effectiveUserId = userId ?? getFirstUserId();

  if (!config.itadApiKey) {
    throw new Error('ITAD API Key is required. Configure it in Settings.');
  }

  const syncLogId = createSyncLog('itad_prices');

  try {
    const client = getITADClient();
    const gamesToSync = getGamesForPriceSync(effectiveUserId);

    console.log(`[PriceSync] ${gamesToSync.length} games for price sync`);

    if (gamesToSync.length === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0);
      return { stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, syncLogId };
    }

    // Step 1: Resolve missing ITAD game IDs
    const gamesNeedingLookup = gamesToSync.filter((g) => !g.itadGameId);
    if (gamesNeedingLookup.length > 0) console.log(`[PriceSync] Resolving ${gamesNeedingLookup.length} ITAD IDs`);
    if (gamesNeedingLookup.length > 0) {
      const appIds = gamesNeedingLookup.map((g) => g.steamAppId);
      const lookupResults = await client.lookupBySteamAppIds(appIds, (done, total) => {
        // Report lookup progress as "phase 1" of the sync
        onProgress?.(done, total + gamesToSync.length);
      });

      // Persist resolved ITAD IDs
      const updates: Array<{ steamAppId: number; itadGameId: string }> = [];
      for (const [steamAppId, itadGameId] of lookupResults) {
        updates.push({ steamAppId, itadGameId });
        // Update our in-memory list
        const game = gamesToSync.find((g) => g.steamAppId === steamAppId);
        if (game) game.itadGameId = itadGameId;
      }
      console.log(`[PriceSync] Resolved ${updates.length}/${appIds.length} ITAD IDs`);
      if (updates.length > 0) {
        bulkUpdateGameItadIds(updates);
      }
    }

    // Step 2: Build mapping of ITAD ID → game record for games we can price-check
    const itadToGame = new Map<string, typeof gamesToSync[0]>();
    for (const game of gamesToSync) {
      if (game.itadGameId) {
        itadToGame.set(game.itadGameId, game);
      }
    }

    console.log(`[PriceSync] Fetching prices for ${itadToGame.size} games`);

    if (itadToGame.size === 0) {
      completeSyncLog(syncLogId, 'success', 0, undefined, 0, 0);
      return { stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, syncLogId };
    }

    // Step 3: Fetch overviews (best price + historical low per game)
    const itadIds = [...itadToGame.keys()];
    const overviews = await client.getOverview(itadIds);
    const attempted = itadToGame.size;
    let succeeded = 0;
    let skipped = 0;
    for (const overview of overviews) {
      if (signal?.aborted) {
        console.log(`[PriceSync] Cancelled after ${succeeded} games`);
        break;
      }

      const game = itadToGame.get(overview.id);
      if (!game) continue;

      // Extract pricing from overview (v2 uses "current" not "price")
      const current = overview.current;
      const lowest = overview.lowest;

      const currentPrice = current?.price?.amount;
      const regularPrice = current?.regular?.amount;
      const cut = current?.cut ?? 0;
      const historicalLowPrice = lowest?.price?.amount;
      const currency = current?.price?.currency ?? 'USD';
      const storeName = current?.shop?.name;

      // Skip if no price data available
      if (currentPrice === undefined || regularPrice === undefined) {
        skipped++;
        continue;
      }

      const isAtATL = historicalLowPrice !== undefined && currentPrice <= historicalLowPrice;

      // Compute deal score for SQL-level sorting using real game data
      let dealScoreValue: number | undefined;
      try {
        const { weights, thresholds } = getScoringConfig();
        const score = calculateDealScore({
          currentPrice,
          regularPrice,
          historicalLow: historicalLowPrice ?? currentPrice,
          reviewPercent: game.reviewScore,
          hltbMainHours: game.hltbMain,
          personalInterest: game.personalInterest ?? 3,
        }, weights, thresholds);
        dealScoreValue = score.overall;
      } catch {
        // Score computation failed — store without score
      }

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

      succeeded++;
      onProgress?.(succeeded, attempted, { gameName: game.title });
    }

    const successRate = attempted > 0 ? succeeded / attempted : 1;
    const threshold = SUCCESS_RATE_THRESHOLDS['itad_prices'] ?? 0.5;
    const logStatus = successRate < threshold ? 'partial' : 'success';
    completeSyncLog(syncLogId, logStatus, succeeded, undefined, attempted, 0);

    // Chain alert checking after successful price sync
    try {
      const { checkPriceAlerts } = await import('./alerts');
      await checkPriceAlerts(undefined, effectiveUserId);
    } catch (alertError) {
      console.error('[PriceSync] Alert check failed:', alertError);
    }

    // Chain release status checking (detects newly released games)
    try {
      const { checkReleaseStatus } = await import('./releases');
      await checkReleaseStatus();
    } catch (releaseError) {
      console.error('[PriceSync] Release check failed:', releaseError);
    }

    return { stats: { attempted, succeeded, failed: 0, skipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
