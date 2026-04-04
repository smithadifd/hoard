/**
 * Price Alert Checker
 *
 * Evaluates active price alerts against latest price snapshots.
 * Sends Discord notifications when alert conditions are met.
 * Designed to run after price sync completes.
 *
 * Notification tiers:
 * - Individual alerts: free games, threshold hits, genuinely new ATLs
 * - Digest: games still sitting at their known ATL (reduces noise)
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
import type { ActiveAlertRow, AutoAlertCandidate } from '../db/queries';
import type { SyncResult, ProgressCallback } from './types';

/** True if the ATL is genuinely new (lower than previously known). */
export function isNewAtl(prevHistoricalLow: number | null | undefined, currentHistoricalLow: number | null): boolean {
  // No previous snapshot = first time we've seen this game — treat as new
  if (prevHistoricalLow == null) return true;
  // Current ATL is lower than what we previously knew = genuine new record
  if (currentHistoricalLow != null && currentHistoricalLow < prevHistoricalLow) return true;
  // Same or higher = still at previously known ATL
  return false;
}

interface DigestGame {
  title: string;
  currentPrice: number;
  regularPrice: number;
  discountPercent: number;
  store: string;
  storeUrl: string;
}

interface PendingNotification {
  type: 'individual' | 'digest';
  // For individual alerts
  alertPayload?: Parameters<ReturnType<typeof getDiscordClient>['sendPriceAlert']>[0];
  // For digest
  digestGame?: DigestGame;
  // Callback to mark as notified on success
  onSent: () => void;
}

function buildAlertPayload(alert: ActiveAlertRow | AutoAlertCandidate, dealScore?: number) {
  const steamAppId = alert.steamAppId;
  let dollarsPerHour: number | undefined;
  if (alert.hltbMain && alert.hltbMain > 0) {
    dollarsPerHour = alert.currentPrice / alert.hltbMain;
  }

  return {
    title: alert.title,
    headerImageUrl: alert.headerImageUrl ?? undefined,
    currentPrice: alert.currentPrice,
    regularPrice: alert.regularPrice,
    historicalLow: alert.historicalLowPrice ?? alert.currentPrice,
    discountPercent: alert.discountPercent,
    store: alert.store,
    storeUrl: ('storeUrl' in alert ? alert.storeUrl : null) ?? `https://store.steampowered.com/app/${steamAppId}`,
    dollarsPerHour,
    reviewDescription: alert.reviewDescription ?? undefined,
    dealScore,
  };
}

export async function checkPriceAlerts(onProgress?: ProgressCallback, userId?: string): Promise<SyncResult> {
  const syncLogId = createSyncLog('alert_check');

  try {
    const config = getEffectiveConfig();
    const effectiveUserId = userId ?? getFirstUserId();
    const activeAlerts = getActivePriceAlerts(effectiveUserId);
    const discord = getDiscordClient();
    const now = new Date();
    let throttled = 0;

    console.log(`[AlertCheck] ${activeAlerts.length} active alerts to evaluate`);

    const pending: PendingNotification[] = [];

    // Evaluate explicit alerts
    for (const alert of activeAlerts) {
      onProgress?.(pending.length, activeAlerts.length);

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
      let triggeredByThreshold = false;

      // Always notify for free games (100% discount)
      if (alert.currentPrice === 0) {
        shouldNotify = true;
      }

      if (alert.notifyOnThreshold && alert.targetPrice !== null) {
        if (alert.currentPrice <= alert.targetPrice) {
          shouldNotify = true;
          triggeredByThreshold = true;
        }
      }

      if (alert.notifyOnAllTimeLow && alert.isHistoricalLow) {
        shouldNotify = true;
      }

      if (!shouldNotify) continue;

      const payload = buildAlertPayload(alert);
      const storeUrl = payload.storeUrl;

      // Classify: individual vs digest
      const isFree = alert.currentPrice === 0;
      const atlTriggered = alert.notifyOnAllTimeLow && alert.isHistoricalLow;
      const isNew = atlTriggered ? isNewAtl(alert.prevHistoricalLowPrice, alert.historicalLowPrice) : false;

      if (isFree || triggeredByThreshold || isNew) {
        pending.push({
          type: 'individual',
          alertPayload: payload,
          onSent: () => updateAlertLastNotified(alert.id),
        });
      } else {
        // Still-at-ATL — goes to digest
        pending.push({
          type: 'digest',
          digestGame: {
            title: alert.title,
            currentPrice: alert.currentPrice,
            regularPrice: alert.regularPrice,
            discountPercent: alert.discountPercent,
            store: alert.store,
            storeUrl,
          },
          onSent: () => updateAlertLastNotified(alert.id),
        });
      }
    }

    // Auto ATL deal alerts
    let autoThrottled = 0;
    const autoAtlEnabled = getSetting('auto_atl_deal_alerts') !== 'false';
    if (autoAtlEnabled) {
      const minScore = 55;
      const candidates = getAutoAlertCandidates(effectiveUserId, minScore);
      console.log(`[AlertCheck] ${candidates.length} auto ATL deal candidates`);

      for (const candidate of candidates) {
        if (candidate.lastAutoAlertAt) {
          const lastNotified = new Date(candidate.lastAutoAlertAt);
          const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
          if (hoursSince < config.alertThrottleHours) {
            autoThrottled++;
            continue;
          }
        }

        const payload = buildAlertPayload(candidate, candidate.dealScore);
        const storeUrl = payload.storeUrl;

        const isFree = candidate.currentPrice === 0;
        const isNew = isNewAtl(candidate.prevHistoricalLowPrice, candidate.historicalLowPrice);

        if (isFree || isNew) {
          pending.push({
            type: 'individual',
            alertPayload: payload,
            onSent: () => updateAutoAlertLastNotified(candidate.gameId, effectiveUserId),
          });
        } else {
          pending.push({
            type: 'digest',
            digestGame: {
              title: candidate.title,
              currentPrice: candidate.currentPrice,
              regularPrice: candidate.regularPrice,
              discountPercent: candidate.discountPercent,
              store: candidate.store,
              storeUrl,
            },
            onSent: () => updateAutoAlertLastNotified(candidate.gameId, effectiveUserId),
          });
        }
      }
    }

    // Send individual alerts
    let notifiedCount = 0;
    const individualAlerts = pending.filter((p) => p.type === 'individual');
    const digestAlerts = pending.filter((p) => p.type === 'digest');

    for (const item of individualAlerts) {
      const sent = await discord.sendPriceAlert(item.alertPayload!);
      if (sent) {
        item.onSent();
        notifiedCount++;
        console.log(`[AlertCheck] Notified: ${item.alertPayload!.title} at $${item.alertPayload!.currentPrice.toFixed(2)}`);
      }
    }

    // Send digest
    if (digestAlerts.length > 0) {
      const digestGames = digestAlerts.map((d) => d.digestGame!);
      const sent = await discord.sendAtlDigest(digestGames);
      if (sent) {
        for (const item of digestAlerts) {
          item.onSent();
        }
        notifiedCount += digestAlerts.length;
        console.log(`[AlertCheck] Digest sent: ${digestAlerts.length} still-at-ATL games`);
      }
    }

    const totalThrottled = throttled + autoThrottled;
    const totalAttempted = pending.length + totalThrottled;
    console.log(`[AlertCheck] Sent ${notifiedCount} notifications (${digestAlerts.length} in digest), ${totalThrottled} throttled`);
    completeSyncLog(syncLogId, 'success', notifiedCount, undefined, totalAttempted, 0);
    return { stats: { attempted: totalAttempted, succeeded: notifiedCount, failed: 0, skipped: totalThrottled }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AlertCheck] Failed:', error);
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
