/**
 * ITAD Price History Backfill
 *
 * Retroactively populates `price_snapshots` from ITAD's per-sale history
 * endpoint. Hoard normally only sees prices from the moment a game enters
 * sync — this backfill fills in everything ITAD has tracked before then.
 *
 * Idempotent: relies on the unique (gameId, store, snapshotDate) index
 * added in migration 0005 to drop duplicate change events on the same day.
 */

import { getEffectiveConfig } from '../config';
import { getITADClient, getAndResetItadApiCalls } from '../itad/client';
import {
  bulkInsertPriceSnapshots,
  createSyncLog,
  completeSyncLog,
  getGameItadInfo,
  type PriceSnapshotInsert,
} from '../db/queries';
import type { ITADHistoryEntry } from '../itad/types';
import { BASE_CURRENCY } from './types';

export interface BackfillResult {
  gameId: number;
  events: number;
  inserted: number;
  skipped: number;
  syncLogId: number;
}

export async function backfillPriceHistory(
  gameId: number,
  options: { since?: Date } = {}
): Promise<BackfillResult> {
  const config = getEffectiveConfig();
  if (!config.itadApiKey) {
    throw new Error('ITAD API Key is required. Configure it in Settings.');
  }

  const game = getGameItadInfo(gameId);
  if (!game) {
    throw new Error(`Game ${gameId} not found`);
  }
  if (!game.itadGameId) {
    throw new Error(
      `Game "${game.title}" is not linked to ITAD yet — run a price sync first.`
    );
  }

  const syncLogId = createSyncLog('itad_history');

  try {
    const client = getITADClient();
    const events = await client.getPriceHistory(game.itadGameId, {
      since: options.since,
    });

    const rows = mapHistoryToSnapshots(gameId, events);
    const { inserted, skipped } = bulkInsertPriceSnapshots(rows);

    completeSyncLog(syncLogId, 'success', inserted, undefined, events.length, 0, getAndResetItadApiCalls());

    return { gameId, events: events.length, inserted, skipped, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message, undefined, undefined, getAndResetItadApiCalls());
    throw error;
  }
}

/**
 * Map ITAD history events to `price_snapshots` insert rows.
 *
 * - `snapshotDate` is the date portion of the event timestamp; the unique
 *   index dedupes multiple changes on the same day per store (keeps first).
 * - `dealScore` and `historicalLowPrice` are intentionally omitted: review %,
 *   HLTB hours, and the running ATL at the time of the event were not known,
 *   and storing today's values against a years-old row would be misleading.
 */
export function mapHistoryToSnapshots(
  gameId: number,
  events: ITADHistoryEntry[]
): PriceSnapshotInsert[] {
  const rows: PriceSnapshotInsert[] = [];
  for (const event of events) {
    const priceCurrent = event.deal?.price?.amount;
    const priceRegular = event.deal?.regular?.amount;
    const storeName = event.shop?.name;
    const snapshotDate = event.timestamp?.slice(0, 10);
    const currency = event.deal?.price?.currency ?? BASE_CURRENCY;

    if (
      priceCurrent === undefined ||
      priceRegular === undefined ||
      !storeName ||
      !snapshotDate
    ) {
      continue;
    }

    // Drop regional storefronts priced in a foreign currency (e.g. GamesPlanet UK in
    // GBP). ITAD returns them even for a US query; charting their raw amount on the USD
    // axis produces phantom sub-ATL dips. See BASE_CURRENCY.
    if (currency !== BASE_CURRENCY) {
      continue;
    }

    rows.push({
      gameId,
      store: storeName,
      priceCurrent,
      priceRegular,
      discountPercent: event.deal?.cut ?? 0,
      currency,
      snapshotDate,
    });
  }
  return rows;
}
