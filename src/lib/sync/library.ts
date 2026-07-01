/**
 * Steam Library Sync
 *
 * Fetches owned games from Steam API and upserts into the database.
 * Does NOT call getAppDetails() for each game — that would be too slow
 * for large libraries. Only stores what getOwnedGames() returns.
 */

import { getSteamClient, getAndResetSteamApiCalls } from '../steam/client';
import {
  upsertGameFromSteam,
  upsertUserGame,
  createSyncLog,
  completeSyncLog,
  getFirstUserId,
  getExistingGamesByAppIds,
  getPreOwnershipState,
  cascadePurchaseCleanup,
  capturePricePaidSuggestions,
  countOwnedGames,
  getSetting,
} from '../db/queries';
import { getDb } from '../db';
import { fetchNetNewPrices } from './net-new-prices';
import { emitNotification } from '../notifications/dispatch';
import { getDiscordClient } from '../discord/client';
import type { NotificationPayload } from '../notifications/types';
import type { SyncResult, ProgressCallback } from './types';

type PricePaidCapture = { gameId: number; title: string; suggested: number; asOf: string };

/**
 * Collapse a batch of price-paid captures from a SINGLE library sync into one
 * in-app summary payload (not one row per game) — mirroring buildDigestInApp in
 * the ATL path. A single capture still reads naturally ("Confirm what you paid
 * for X"), not "1 game".
 */
function buildPricePaidInApp(captures: PricePaidCapture[]): NotificationPayload {
  const count = captures.length;
  if (count === 1) {
    const s = captures[0];
    return {
      title: `Confirm what you paid for ${s.title}`,
      body: `Last tracked at ~$${s.suggested.toFixed(2)} on ${s.asOf}. Confirm or update it to unlock realized $/hr.`,
      link: `/games/${s.gameId}`,
      metadata: { gameId: s.gameId, suggested: s.suggested, asOf: s.asOf },
    };
  }

  const names = captures.slice(0, 3).map((c) => c.title);
  const remainder = count - names.length;
  const list = remainder > 0 ? `${names.join(', ')} and ${remainder} more` : names.join(', ');
  return {
    title: `You may have bought ${count} games — confirm what you paid`,
    body: `${list}. Confirm or update each price to unlock realized $/hr.`,
    link: '/library',
    metadata: {
      count,
      games: captures.map((c) => ({
        gameId: c.gameId,
        title: c.title,
        suggested: c.suggested,
        asOf: c.asOf,
      })),
    },
  };
}

export async function syncLibrary(onProgress?: ProgressCallback, signal?: AbortSignal, userId?: string): Promise<SyncResult> {
  const effectiveUserId = userId ?? getFirstUserId();
  const syncLogId = createSyncLog('steam_library');

  try {
    const client = getSteamClient();
    const response = await client.getOwnedGames();

    const total = response.games.length;
    let processed = 0;
    let newlyPurchasedCount = 0;
    // Price-paid suggestions captured this run (written in-txn, notified after commit).
    let capturedSuggestions: PricePaidCapture[] = [];
    // Net-new owned adds that were NEVER wishlisted (part 2). These have no
    // snapshot yet, so after commit we fetch an ITAD price then capture a
    // suggestion for them. Collected in-txn; processed post-commit (async).
    let netNewOwnedIds: number[] = [];
    // Master opt-out — skip the whole capture (and thus all surfaces) when disabled.
    const suggestPrices = getSetting('price_paid_suggestions_enabled') !== 'false';

    // Prior owned count, read BEFORE the upserts flip everything to owned. Zero
    // means this is the very first library import (onboarding) — the drain primes
    // prices for the whole library, so we skip the net-new fetch lane entirely to
    // avoid a fetch-per-game flood. The lane only fires "going forward".
    const hadOwnedGamesBefore = countOwnedGames(effectiveUserId) > 0;

    const appIds = response.games.map((g) => g.appid);

    const sqlite = getDb().$client;
    const runSync = sqlite.transaction(() => {
      // Read prior ownership state INSIDE the transaction so a concurrent
      // wishlist sync can't race in between the read and the upserts. Any
      // game that was wishlisted-but-not-owned and is about to be marked
      // owned is a new purchase — cascade its alerts + wishlist cleanup.
      const existing = getExistingGamesByAppIds(appIds);
      const existingGameIds = Array.from(existing.values()).map((g) => g.id);
      const priors = getPreOwnershipState(existingGameIds, effectiveUserId);
      const newlyPurchasedIds = priors
        .filter((p) => p.wasWishlisted && !p.wasOwned)
        .map((p) => p.gameId);
      // Net-new owned adds that were never wishlisted: a prior row that was
      // neither owned nor wishlisted (e.g. ignored, or a bare row). Brand-new
      // games (no prior row at all) are added below, after their upsert assigns
      // an id. Only tracked once the library is past its initial import.
      const priorByGameId = new Map(priors.map((p) => [p.gameId, p]));
      const netNewNonWishlistIds: number[] = [];
      if (hadOwnedGamesBefore) {
        for (const p of priors) {
          if (!p.wasOwned && !p.wasWishlisted) netNewNonWishlistIds.push(p.gameId);
        }
      }

      for (const steamGame of response.games) {
        if (signal?.aborted) {
          console.log(`[LibrarySync] Cancelled after ${processed} games`);
          break;
        }

        const priorGameId = existing.get(steamGame.appid)?.id;

        const gameId = upsertGameFromSteam({
          steamAppId: steamGame.appid,
          title: steamGame.name,
        });

        // Brand-new owned add (part 2): the game had no prior user_games row —
        // either wholly new to Hoard (not in `existing`) or present but never
        // tracked by this user. Either way it's a straight purchase that was
        // never wishlisted, so it qualifies for the net-new price fetch. Games
        // with a prior row are handled by the pre-loop priors scan.
        if (hadOwnedGamesBefore && (priorGameId === undefined || !priorByGameId.has(gameId))) {
          netNewNonWishlistIds.push(gameId);
        }

        upsertUserGame(gameId, {
          isOwned: true,
          playtimeMinutes: steamGame.playtime_forever,
          playtimeRecentMinutes: steamGame.playtime_2weeks ?? 0,
          lastPlayed:
            steamGame.rtime_last_played > 0
              ? new Date(steamGame.rtime_last_played * 1000).toISOString()
              : undefined,
        }, effectiveUserId);

        processed++;
        onProgress?.(processed, total, { gameName: steamGame.name });
      }

      if (newlyPurchasedIds.length > 0) {
        cascadePurchaseCleanup(newlyPurchasedIds, effectiveUserId);
        if (suggestPrices) {
          capturedSuggestions = capturePricePaidSuggestions(newlyPurchasedIds, effectiveUserId);
        }
        newlyPurchasedCount = newlyPurchasedIds.length;
      }

      // Hand the net-new non-wishlist owned adds out of the txn. Their price
      // fetch + suggestion capture happens post-commit (needs async ITAD calls).
      if (suggestPrices) netNewOwnedIds = netNewNonWishlistIds;
    });
    runSync();

    if (newlyPurchasedCount > 0) {
      console.log(
        `[LibrarySync] Detected ${newlyPurchasedCount} purchase(s) — deactivated alerts, removed from wishlist`,
      );
    }

    // Net-new owned adds that were never wishlisted (part 2): they have no
    // snapshot yet, so fetch an ITAD price NOW (resolving the ITAD id first if
    // needed), then capture a price-paid suggestion so the nudge has data. This
    // is the "invest in coverage, but only for net-new adds" lane — done after
    // commit because ITAD calls are async and the txn callback must stay sync.
    // Best-effort and isolated: an ITAD failure must never fail the library sync.
    if (netNewOwnedIds.length > 0) {
      try {
        const { snapshotted } = await fetchNetNewPrices(netNewOwnedIds);
        if (snapshotted > 0) {
          console.log(`[LibrarySync] Priced ${snapshotted} net-new owned add(s) for price-paid capture`);
          // capturePricePaidSuggestions reads the snapshot we just wrote; merge
          // into this run's batch so everything collapses into one nudge.
          const netNewCaptures = capturePricePaidSuggestions(netNewOwnedIds, effectiveUserId);
          if (netNewCaptures.length > 0) capturedSuggestions = [...capturedSuggestions, ...netNewCaptures];
        }
      } catch (error) {
        console.error('[LibrarySync] Net-new price fetch failed (non-fatal):', error);
      }
    }

    // Fire the price-paid-suggestion nudge AFTER the commit: emitNotification is async
    // and a better-sqlite3 transaction callback must stay synchronous. The call is
    // self-isolating (never throws), so a notification failure can't fail the sync.
    //
    // All captures from this single sync collapse into ONE in-app row + ONE Discord
    // embed (digest), mirroring the ATL alert path. This keeps onboarding/first-import
    // safe from a per-game flood. Discord routing for this category defaults OFF
    // (see preferences.ts) and is opt-in via the Settings toggle; the thunk below
    // makes that toggle work end-to-end.
    if (capturedSuggestions.length > 0) {
      const discord = getDiscordClient();
      await emitNotification({
        category: 'price-paid-suggestion',
        userId: effectiveUserId,
        inApp: buildPricePaidInApp(capturedSuggestions),
        discord: () => discord.sendPricePaidSuggestion(capturedSuggestions),
      });
    }

    completeSyncLog(syncLogId, 'success', processed, undefined, total, 0, getAndResetSteamApiCalls());
    return { stats: { attempted: total, succeeded: processed, failed: 0, skipped: 0 }, syncLogId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    completeSyncLog(syncLogId, 'error', 0, message, undefined, undefined, getAndResetSteamApiCalls());
    throw error;
  }
}
