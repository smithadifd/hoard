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
import { milestones } from '../onboarding/milestones';
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
  // No previous snapshot = no baseline; we can't claim this is "new" yet
  if (prevHistoricalLow == null) return false;
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
    let insufficientHistory = 0;

    // Minimum snapshots required before any ATL alert fires for a game.
    // Guards against firing on the very first observation of a new wishlist game
    // when ITAD's reported historical low happens to equal the current price.
    const minSnapshotsRaw = getSetting('min_snapshots_for_atl_alert');
    const parsedMin = Number(minSnapshotsRaw ?? '3');
    const minSnapshots = Number.isFinite(parsedMin) && parsedMin >= 1 ? Math.floor(parsedMin) : 3;

    console.log(`[AlertCheck] ${activeAlerts.length} active alerts to evaluate (min snapshots for ATL: ${minSnapshots})`);

    const pending: PendingNotification[] = [];

    // Evaluate explicit alerts
    for (const alert of activeAlerts) {
      onProgress?.(pending.length, activeAlerts.length);

      // Classify trigger conditions before throttle so we can let a genuine new ATL
      // break through even if a recent digest or alert consumed the throttle slot.
      const isFree = alert.currentPrice === 0;
      const triggeredByThreshold = !!(
        alert.notifyOnThreshold &&
        alert.targetPrice !== null &&
        alert.currentPrice <= alert.targetPrice
      );

      // Gate ATL trigger: need enough observed history before we can claim ATL.
      // Threshold and free triggers remain unguarded — those are explicit prices the user set.
      const atlGated = alert.notifyOnAllTimeLow && alert.isHistoricalLow && alert.snapshotCount < minSnapshots;
      if (atlGated) insufficientHistory++;
      const atlTriggered = !!alert.notifyOnAllTimeLow && !!alert.isHistoricalLow && !atlGated;
      const isNew = atlTriggered ? isNewAtl(alert.prevHistoricalLowPrice, alert.historicalLowPrice) : false;

      const shouldNotify = isFree || triggeredByThreshold || atlTriggered;
      if (!shouldNotify) continue;

      // Throttle: skip if notified within the configured period.
      // A genuine new ATL bypasses the throttle — it's fresh news that should
      // ping immediately even if a still-at-ATL digest recently consumed the slot.
      if (!isNew && alert.lastNotifiedAt) {
        const lastNotified = new Date(alert.lastNotifiedAt);
        const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
        if (hoursSince < config.alertThrottleHours) {
          throttled++;
          continue;
        }
      }

      const payload = buildAlertPayload(alert);
      const storeUrl = payload.storeUrl;

      if (isFree || triggeredByThreshold || isNew) {
        pending.push({
          type: 'individual',
          alertPayload: payload,
          onSent: () => updateAlertLastNotified(alert.id),
        });
      } else if (alert.discountPercent > 0) {
        // Still-at-ATL with a real discount — goes to digest
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
      // else: at "ATL" because regular price never dropped — not a deal, skip silently
    }

    // Auto ATL deal alerts
    let autoThrottled = 0;
    const autoAtlEnabled = getSetting('auto_atl_deal_alerts') !== 'false';
    if (autoAtlEnabled) {
      const minScore = 55;
      const candidates = getAutoAlertCandidates(effectiveUserId, minScore);
      console.log(`[AlertCheck] ${candidates.length} auto ATL deal candidates`);

      for (const candidate of candidates) {
        // Auto alerts only ever fire on ATL — fully skip when history is too thin.
        if (candidate.snapshotCount < minSnapshots) {
          insufficientHistory++;
          continue;
        }

        const isFree = candidate.currentPrice === 0;
        const isNew = isNewAtl(candidate.prevHistoricalLowPrice, candidate.historicalLowPrice);

        // Throttle: skip if recently notified. A genuine new ATL bypasses — a
        // "still at ATL" digest entry on day N must not silence a genuine new ATL
        // on day N+1 that lands inside the throttle window.
        if (!isNew && candidate.lastAutoAlertAt) {
          const lastNotified = new Date(candidate.lastAutoAlertAt);
          const hoursSince = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);
          if (hoursSince < config.alertThrottleHours) {
            autoThrottled++;
            continue;
          }
        }

        const payload = buildAlertPayload(candidate, candidate.dealScore);
        const storeUrl = payload.storeUrl;

        if (isFree || isNew) {
          pending.push({
            type: 'individual',
            alertPayload: payload,
            onSent: () => updateAutoAlertLastNotified(candidate.gameId, effectiveUserId),
          });
        } else if (candidate.discountPercent > 0) {
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
        // else: at "ATL" because regular price never dropped — not a deal, skip silently
      }
    }

    // Send individual alerts
    let notifiedCount = 0;
    let firstDealFiredThisRun = false;
    const individualAlerts = pending.filter((p) => p.type === 'individual');
    const digestAlerts = pending.filter((p) => p.type === 'digest');

    for (const item of individualAlerts) {
      const sent = await discord.sendPriceAlert(item.alertPayload!);
      if (sent) {
        item.onSent();
        notifiedCount++;
        if (!firstDealFiredThisRun) {
          firstDealFiredThisRun = true;
          // Idempotent across runs via the milestones ledger.
          void milestones.firstDeal(effectiveUserId, item.alertPayload!.title);
        }
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
    const totalSkipped = totalThrottled + insufficientHistory;
    const totalAttempted = pending.length + totalSkipped;
    console.log(
      `[AlertCheck] Sent ${notifiedCount} notifications (${digestAlerts.length} in digest), ${totalThrottled} throttled, ${insufficientHistory} skipped for insufficient history`,
    );
    completeSyncLog(syncLogId, 'success', notifiedCount, undefined, totalAttempted, 0);
    return { stats: { attempted: totalAttempted, succeeded: notifiedCount, failed: 0, skipped: totalSkipped }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AlertCheck] Failed:', error);
    completeSyncLog(syncLogId, 'error', 0, message);
    throw error;
  }
}
