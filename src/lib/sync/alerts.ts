/**
 * Price Alert Checker
 *
 * Evaluates active price alerts against latest price snapshots.
 * Sends Discord notifications when alert conditions are met.
 * Designed to run after price sync completes.
 */

import { getEffectiveConfig } from '../config';
import { getDiscordClient } from '../discord/client';
import {
  getActivePriceAlerts,
  updateAlertLastNotified,
  createSyncLog,
  completeSyncLog,
} from '../db/queries';
import type { ProgressCallback, SyncResult } from './prices';

export async function checkPriceAlerts(onProgress?: ProgressCallback): Promise<SyncResult> {
  const syncLogId = createSyncLog('alert_check');

  try {
    const config = getEffectiveConfig();
    const activeAlerts = getActivePriceAlerts();
    const discord = getDiscordClient();
    const now = new Date();
    let notifiedCount = 0;

    console.log(`[AlertCheck] ${activeAlerts.length} active alerts to evaluate`);

    if (activeAlerts.length === 0) {
      completeSyncLog(syncLogId, 'success', 0);
      return { gamesProcessed: 0, syncLogId };
    }

    for (const alert of activeAlerts) {
      onProgress?.(notifiedCount, activeAlerts.length);

      // Throttle: skip if notified within the configured period
      if (alert.lastNotifiedAt) {
        const lastNotified = new Date(alert.lastNotifiedAt);
        const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
        if (hoursSince < config.alertThrottleHours) continue;
      }

      // Check trigger conditions
      let shouldNotify = false;

      if (alert.notifyOnThreshold && alert.targetPrice !== null) {
        if (alert.currentPrice <= alert.targetPrice) {
          shouldNotify = true;
        }
      }

      if (alert.notifyOnAllTimeLow && alert.isHistoricalLow) {
        shouldNotify = true;
      }

      if (!shouldNotify) continue;

      // Compute $/hr for the notification
      let dollarsPerHour: number | undefined;
      if (alert.hltbMain && alert.hltbMain > 0) {
        dollarsPerHour = alert.currentPrice / alert.hltbMain;
      }

      // Send Discord notification
      const sent = await discord.sendPriceAlert({
        title: alert.title,
        headerImageUrl: alert.headerImageUrl ?? undefined,
        currentPrice: alert.currentPrice,
        regularPrice: alert.regularPrice,
        historicalLow: alert.historicalLowPrice ?? alert.currentPrice,
        discountPercent: alert.discountPercent,
        store: alert.store,
        storeUrl: alert.storeUrl ?? `https://store.steampowered.com/app/${alert.steamAppId}`,
        dollarsPerHour,
        reviewDescription: alert.reviewDescription ?? undefined,
      });

      if (sent) {
        updateAlertLastNotified(alert.id);
        notifiedCount++;
        console.log(`[AlertCheck] Notified: ${alert.title} at $${alert.currentPrice.toFixed(2)}`);
      }
    }

    console.log(`[AlertCheck] Sent ${notifiedCount} notifications`);
    completeSyncLog(syncLogId, 'success', notifiedCount);
    return { gamesProcessed: notifiedCount, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AlertCheck] Failed:', error);
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
