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
import { emitNotification } from '../notifications/dispatch';
import type { NotificationPayload } from '../notifications/types';
import {
  getActivePriceAlerts,
  updateAlertLastNotified,
  getAutoAlertCandidates,
  updateAutoAlertLastNotified,
  getSetting,
  setSetting,
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

/**
 * Parse a timestamp that may be either ISO-8601 (`...Z`, from `toISOString()`) or
 * SQLite's `datetime('now')` form (`YYYY-MM-DD HH:MM:SS`, UTC, no zone). Returns ms,
 * or NaN if unparseable. The container runs in UTC, but normalizing explicitly keeps
 * the comparison correct in dev/test environments on other timezones.
 */
function parseTimestampMs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  return new Date(iso).getTime();
}

/**
 * True if we've already notified for the current (latest) snapshot — i.e. the last
 * notification happened at or after that snapshot was recorded. Snapshots are deduped
 * to one row per (game, store, day), so a second same-day price-check run re-evaluates
 * the *same* latest snapshot. Without this guard, a genuine-new-ATL run earlier in the
 * day re-fires on the next run because `isNewAtl` still sees the (unchanged) previous-day
 * baseline. This lets the new-ATL throttle bypass fire once per snapshot, not once per run.
 */
export function alreadyNotifiedForSnapshot(
  lastNotifiedAt: string | null | undefined,
  latestSnapshotAt: string | null | undefined,
): boolean {
  const notified = parseTimestampMs(lastNotifiedAt);
  const snapshot = parseTimestampMs(latestSnapshotAt);
  if (Number.isNaN(notified) || Number.isNaN(snapshot)) return false;
  return notified >= snapshot;
}

const LAST_DIGEST_DATE_KEY = 'last_atl_digest_date';

/** Local YYYY-MM-DD for the server timezone — the dedup key for the once-daily digest. */
export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Decide whether this run should send the once-daily "still at ATL" digest.
 *
 * Price checks run every 12h so a genuine new ATL still pings immediately (those go
 * out as individual alerts, never throttled here). The *reminder* digest, however,
 * should land once per day so the list is complete and stable instead of two
 * alternating half-lists. We send on the first run on/after `digestHour` (server-local,
 * matching quiet hours) each day, deduped by `lastDigestDate` so an off-cycle run later
 * the same day doesn't re-send. Pure — the caller supplies the current hour and date
 * key, so this stays free of `new Date()` and easy to test.
 */
export function shouldSendDigest(
  currentHour: number,
  currentDateKey: string,
  digestHour: number,
  lastDigestDate: string | null | undefined,
): boolean {
  return currentHour >= digestHour && lastDigestDate !== currentDateKey;
}

interface DigestGame {
  gameId: number;
  title: string;
  currentPrice: number;
  regularPrice: number;
  discountPercent: number;
  store: string;
  storeUrl: string;
}

interface PendingNotification {
  type: 'individual' | 'digest';
  // Internal games.id, so the in-app notification can deep-link to the detail page.
  gameId: number;
  // For individual alerts
  alertPayload?: Parameters<ReturnType<typeof getDiscordClient>['sendPriceAlert']>[0];
  // Why an individual alert routed individually. New-ATL alerts are the burst-prone ones a
  // sale floods; free games and explicit threshold hits are rare, high-signal, and always
  // ping individually — never folded into the burst digest.
  individualKind?: 'new-atl' | 'priority';
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

type DealPayload = NonNullable<PendingNotification['alertPayload']>;

/** Map a Discord deal payload to an in-app notification (one row per deal). */
function mapDealToInApp(payload: DealPayload, gameId: number): NotificationPayload {
  const isFree = payload.currentPrice === 0;
  const priceStr = `$${payload.currentPrice.toFixed(2)}`;
  const discountStr = payload.discountPercent > 0 ? ` (-${payload.discountPercent}%)` : '';
  return {
    title: isFree ? `${payload.title} is now free` : `${payload.title} — ${priceStr}`,
    body: isFree ? `Free on ${payload.store}` : `${priceStr} on ${payload.store}${discountStr}`,
    // Deep-link to the game detail page (price history, value, and store links live there)
    // rather than straight to the store; the store URL stays in metadata.
    link: `/games/${gameId}`,
    metadata: {
      store: payload.store,
      storeUrl: payload.storeUrl,
      currentPrice: payload.currentPrice,
      regularPrice: payload.regularPrice,
      discountPercent: payload.discountPercent,
      dealScore: payload.dealScore ?? null,
    },
  };
}

/**
 * Collapse a batch of ATL games into a single summary notification (not one per game).
 * `kind` selects the framing: 'new' for a sale-day burst of games that just hit a new low,
 * 'still' for the once-daily roundup of games sitting at a previously-known low. Both share
 * the same metadata shape so the in-app digest modal renders either identically.
 */
function buildDigestInApp(digestGames: DigestGame[], kind: 'new' | 'still'): NotificationPayload {
  const count = digestGames.length;
  const names = digestGames.slice(0, 3).map((g) => g.title);
  const remainder = count - names.length;
  const list = remainder > 0 ? `${names.join(', ')} and ${remainder} more` : names.join(', ');
  const title =
    kind === 'new'
      ? `${count} game${count === 1 ? '' : 's'} just hit all-time low${count === 1 ? '' : 's'}`
      : `${count} game${count === 1 ? '' : 's'} still at all-time low`;
  return {
    title,
    body: list,
    link: '/wishlist',
    metadata: {
      count,
      games: digestGames.map((g) => ({
        gameId: g.gameId,
        title: g.title,
        currentPrice: g.currentPrice,
        discountPercent: g.discountPercent,
        store: g.store,
        storeUrl: g.storeUrl,
      })),
    },
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

    // The still-at-ATL digest is a once-daily reminder, decoupled from the 12h price-check
    // cadence. On non-digest runs we still queue individual (new-ATL/threshold/free) alerts,
    // but skip gathering digest entries entirely so we don't half-send or churn the throttle.
    const digestDateKey = localDateKey(now);
    const digestSend = shouldSendDigest(
      now.getHours(),
      digestDateKey,
      config.atlDigestHour,
      getSetting(LAST_DIGEST_DATE_KEY),
    );

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
      // A new ATL only counts as "new" once per snapshot. The daily-deduped snapshot
      // doesn't advance on a second same-day run, so without this guard isNewAtl would
      // keep seeing the previous-day baseline and re-fire the same alert every run.
      const isNew =
        atlTriggered &&
        isNewAtl(alert.prevHistoricalLowPrice, alert.historicalLowPrice) &&
        !alreadyNotifiedForSnapshot(alert.lastNotifiedAt, alert.latestSnapshotAt);

      const shouldNotify = isFree || triggeredByThreshold || atlTriggered;
      if (!shouldNotify) continue;

      const routeIndividual = isFree || triggeredByThreshold || isNew;

      if (routeIndividual) {
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

        pending.push({
          type: 'individual',
          gameId: alert.gameId,
          alertPayload: buildAlertPayload(alert),
          // Free and explicit-threshold hits stay individual even in a burst; only a generic
          // new ATL is foldable into the sale digest.
          individualKind: isFree || triggeredByThreshold ? 'priority' : 'new-atl',
          onSent: () => updateAlertLastNotified(alert.id),
        });
      } else if (alert.discountPercent > 0) {
        // Still-at-ATL with a real discount — goes to the once-daily digest. Frequency is
        // controlled by the daily digest gate, not the 24h throttle, so every still-at-ATL
        // game appears in each day's complete list. Skip entirely on non-digest runs.
        if (!digestSend) continue;
        const payload = buildAlertPayload(alert);
        pending.push({
          type: 'digest',
          gameId: alert.gameId,
          digestGame: {
            gameId: alert.gameId,
            title: alert.title,
            currentPrice: alert.currentPrice,
            regularPrice: alert.regularPrice,
            discountPercent: alert.discountPercent,
            store: alert.store,
            storeUrl: payload.storeUrl,
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
        // See the explicit-alert path: gate the new-ATL bypass to once per snapshot so a
        // second same-day run doesn't re-fire against the unchanged daily snapshot.
        const isNew =
          isNewAtl(candidate.prevHistoricalLowPrice, candidate.historicalLowPrice) &&
          !alreadyNotifiedForSnapshot(candidate.lastAutoAlertAt, candidate.latestSnapshotAt);

        if (isFree || isNew) {
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

          pending.push({
            type: 'individual',
            gameId: candidate.gameId,
            alertPayload: buildAlertPayload(candidate, candidate.dealScore),
            // Auto alerts only ever fire free or new-ATL; free is high-signal and stays individual.
            individualKind: isFree ? 'priority' : 'new-atl',
            onSent: () => updateAutoAlertLastNotified(candidate.gameId, effectiveUserId),
          });
        } else if (candidate.discountPercent > 0) {
          // Still-at-ATL with a discount — once-daily digest, gated like the explicit path.
          if (!digestSend) continue;
          const payload = buildAlertPayload(candidate, candidate.dealScore);
          pending.push({
            type: 'digest',
            gameId: candidate.gameId,
            digestGame: {
              gameId: candidate.gameId,
              title: candidate.title,
              currentPrice: candidate.currentPrice,
              regularPrice: candidate.regularPrice,
              discountPercent: candidate.discountPercent,
              store: candidate.store,
              storeUrl: payload.storeUrl,
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

    // Partition: only generic new-ATL alerts are burst-foldable. Free games and explicit
    // threshold hits are rare and high-signal, so they always ping individually — never buried.
    const newAtlAlerts = individualAlerts.filter((p) => p.individualKind === 'new-atl');
    const priorityAlerts = individualAlerts.filter((p) => p.individualKind !== 'new-atl');

    // Burst gate: when one run produces this many genuinely-new ATLs, it's a sale — N correlated
    // events, not N independent ones. Collapse them into a single summary instead of flooding the
    // bell (which caps at 20) and Discord. Tunable via the `atl_burst_threshold` setting; default 8.
    const burstRaw = getSetting('atl_burst_threshold');
    const parsedBurst = Number(burstRaw ?? '8');
    const burstThreshold = Number.isFinite(parsedBurst) && parsedBurst >= 2 ? Math.floor(parsedBurst) : 8;
    const burst = newAtlAlerts.length >= burstThreshold;

    const sendIndividual = async (item: PendingNotification) => {
      const payload = item.alertPayload!;
      const { inAppDelivered, discordDelivered } = await emitNotification({
        category: 'deal-individual',
        userId: effectiveUserId,
        inApp: mapDealToInApp(payload, item.gameId),
        discord: () => discord.sendPriceAlert(payload),
      });
      // Consume the throttle slot if the deal reached the user on any channel.
      if (inAppDelivered || discordDelivered) {
        item.onSent();
        notifiedCount++;
        if (!firstDealFiredThisRun) {
          firstDealFiredThisRun = true;
          // Idempotent across runs via the milestones ledger.
          void milestones.firstDeal(effectiveUserId, payload.title);
        }
        console.log(`[AlertCheck] Notified: ${payload.title} at $${payload.currentPrice.toFixed(2)}`);
      }
    };

    // Below the burst threshold, every individual alert pings on its own (the normal case).
    // At/above it, only the priority (free/threshold) alerts do; the new-ATL flood is condensed.
    for (const item of burst ? priorityAlerts : individualAlerts) {
      await sendIndividual(item);
    }

    // Burst digest — collapse the new-ATL flood into one summary on both channels (in-app + Discord),
    // mirroring the still-at-ATL digest below but framed as games that *just* hit a new low.
    if (burst) {
      const burstGames: DigestGame[] = newAtlAlerts.map((item) => {
        const p = item.alertPayload!;
        return {
          gameId: item.gameId,
          title: p.title,
          currentPrice: p.currentPrice,
          regularPrice: p.regularPrice,
          discountPercent: p.discountPercent,
          store: p.store,
          storeUrl: p.storeUrl,
        };
      });
      const { inAppDelivered, discordDelivered } = await emitNotification({
        // Route under 'deal-individual', not 'deal-digest': these are individual new-ATL deals
        // condensed only for *presentation*. They must honor the user's individual-deal channel
        // toggle, so disabling the (lower-signal) still-at-ATL digest never silences a sale's new
        // lows. Both categories map to the same in-app type and quiet-hours set, so only routing
        // changes — the digest rendering (modal + embed via metadata.games) is unaffected.
        category: 'deal-individual',
        userId: effectiveUserId,
        inApp: buildDigestInApp(burstGames, 'new'),
        discord: () => discord.sendAtlDigest(burstGames, 'new'),
      });
      if (inAppDelivered || discordDelivered) {
        for (const item of newAtlAlerts) item.onSent();
        notifiedCount += newAtlAlerts.length;
        if (!firstDealFiredThisRun) {
          firstDealFiredThisRun = true;
          void milestones.firstDeal(effectiveUserId, burstGames[0].title);
        }
        console.log(`[AlertCheck] Burst-condensed ${newAtlAlerts.length} new-ATL alerts into one digest`);
      }
    }

    // Send digest — one fan-out for the whole batch (one Discord embed, one in-app summary)
    if (digestAlerts.length > 0) {
      const digestGames = digestAlerts.map((d) => d.digestGame!);
      const { inAppDelivered, discordDelivered } = await emitNotification({
        category: 'deal-digest',
        userId: effectiveUserId,
        inApp: buildDigestInApp(digestGames, 'still'),
        discord: () => discord.sendAtlDigest(digestGames, 'still'),
      });
      if (inAppDelivered || discordDelivered) {
        for (const item of digestAlerts) {
          item.onSent();
        }
        // Record the date so off-cycle runs later today don't re-send the digest.
        setSetting(LAST_DIGEST_DATE_KEY, digestDateKey, 'Last date (server-local) the still-at-ATL digest was sent');
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
