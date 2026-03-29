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
  getAutoAlertCandidates,
  updateAutoAlertLastNotified,
  getSetting,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
} from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';

export async function checkPriceAlerts(onProgress?: ProgressCallback, userId?: string): Promise<SyncResult> {
  const syncLogId = createSyncLog('alert_check');

  try {
    const config = getEffectiveConfig();
    const effectiveUserId = userId ?? getFirstUserId();
    const activeAlerts = getActivePriceAlerts(effectiveUserId);
    const discord = getDiscordClient();
    const now = new Date();
    let notifiedCount = 0;
    let throttled = 0;

    console.log(`[AlertCheck] ${activeAlerts.length} active alerts to evaluate`);

    for (const alert of activeAlerts) {
      onProgress?.(notifiedCount, activeAlerts.length);

      // Throttle: skip if notified within the configured period
      if (alert.lastNotifiedAt) {
        const lastNotified = new Date(alert.lastNotifiedAt);
        const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
        if (hoursSince < config.alertThrottleHours) {
          throttled++;
          continue;
        }
      }

      // Check trigger conditions
      let shouldNotify = false;

      // Always notify for free games (100% discount)
      if (alert.currentPrice === 0) {
        shouldNotify = true;
      }

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

    // Auto ATL deal alerts: notify for wishlisted games at ATL with good+ deal score
    let autoNotified = 0;
    let autoThrottled = 0;
    const autoAtlEnabled = getSetting('auto_atl_deal_alerts') !== 'false'; // default on
    if (autoAtlEnabled) {
      const minScore = 55; // "Good" deal threshold
      const candidates = getAutoAlertCandidates(effectiveUserId, minScore);
      console.log(`[AlertCheck] ${candidates.length} auto ATL deal candidates`);

      for (const candidate of candidates) {
        // Throttle: skip if auto-notified within configured period
        if (candidate.lastAutoAlertAt) {
          const lastNotified = new Date(candidate.lastAutoAlertAt);
          const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
          if (hoursSince < config.alertThrottleHours) {
            autoThrottled++;
            continue;
          }
        }

        let dollarsPerHour: number | undefined;
        if (candidate.hltbMain && candidate.hltbMain > 0) {
          dollarsPerHour = candidate.currentPrice / candidate.hltbMain;
        }

        const sent = await discord.sendPriceAlert({
          title: candidate.title,
          headerImageUrl: candidate.headerImageUrl ?? undefined,
          currentPrice: candidate.currentPrice,
          regularPrice: candidate.regularPrice,
          historicalLow: candidate.historicalLowPrice ?? candidate.currentPrice,
          discountPercent: candidate.discountPercent,
          store: candidate.store,
          storeUrl: candidate.storeUrl ?? `https://store.steampowered.com/app/${candidate.steamAppId}`,
          dollarsPerHour,
          reviewDescription: candidate.reviewDescription ?? undefined,
          dealScore: candidate.dealScore,
        });

        if (sent) {
          updateAutoAlertLastNotified(candidate.gameId, effectiveUserId);
          autoNotified++;
          console.log(`[AlertCheck] Auto ATL: ${candidate.title} at $${candidate.currentPrice.toFixed(2)} (score: ${candidate.dealScore})`);
        }
      }
    }

    const totalNotified = notifiedCount + autoNotified;
    const totalThrottled = throttled + autoThrottled;
    const totalAttempted = activeAlerts.length + (autoAtlEnabled ? (autoNotified + autoThrottled) : 0);
    console.log(`[AlertCheck] Sent ${totalNotified} notifications (${autoNotified} auto ATL), ${totalThrottled} throttled`);
    completeSyncLog(syncLogId, 'success', totalNotified, undefined, totalAttempted, 0);
    return { stats: { attempted: totalAttempted, succeeded: totalNotified, failed: 0, skipped: totalThrottled }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AlertCheck] Failed:', error);
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
