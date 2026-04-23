---
title: Data sources
description: Steam, ITAD, HLTB, Discord — what each provides, auth, rate limits, and known quirks.
---

Hoard pulls from four external sources. Three of them feed into the database on a schedule; the fourth is outbound-only. The UI reads exclusively from SQLite — no live API calls at render time.

## Steam Web API

**What it provides:** your owned library (with playtime), wishlist, app metadata (categories, description, developer, publisher, co-op flags), and review summaries (score percentage and review count).

**Auth:** two env vars — `STEAM_API_KEY` (get one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) and `STEAM_USER_ID` (a 17-digit Steam64 ID, e.g. `76561198012345678`). Both are read lazily from the DB settings table on each call, so changes in Settings take effect immediately.

**Profile visibility:** both the library and wishlist endpoints silently return empty data if your Steam profile visibility is not set to Public. The `getOwnedGames` call checks for this and throws a descriptive error; `getWishlist` just returns an empty array.

**Endpoints used:**

| Method | Endpoint |
|---|---|
| `GET` | `api.steampowered.com/IPlayerService/GetOwnedGames/v1/` |
| `GET` | `api.steampowered.com/IWishlistService/GetWishlist/v1/` |
| `GET` | `store.steampowered.com/api/appdetails?appids={id}` |
| `GET` | `store.steampowered.com/appreviews/{id}?json=1` |

**Rate limits:** the Web API (owned games, wishlist) has a 100,000 calls/day quota. The Store API (`appdetails`, `appreviews`) is undocumented but the client comments note approximately 200 requests per 5 minutes as the practical ceiling.

**Batch behavior:** `batchGetAppDetails` processes one app at a time with a default 1,500 ms delay between requests. Review sync also processes in batches of 100 with a 3,000 ms inter-request delay (two API calls per game — `appdetails` and `appreviews`).

**Stale threshold:** review data refreshes after 30 days. Library and wishlist sync on every scheduled run (no staleness guard — they're lightweight list calls).

**Default schedule:** library sync at 3:00 am daily (`CRON_LIBRARY_SYNC`); wishlist sync at 1:00 am daily (`CRON_WISHLIST_SYNC`); review enrichment twice a week on Tuesday and Friday at 4:00 am (`CRON_REVIEW_SYNC`).

**Gotchas:**

- The wishlist API (`IWishlistService/GetWishlist/v1`) returns only `appid`, `priority`, and `date_added`. Game names and metadata come from a separate `appdetails` call.
- `appdetails` returns `success: false` for unreleased DLC, region-restricted titles, and some delisted games — the client returns `null` and logs the failure.
- A 400 response from the Web API almost always means the Steam64 ID is wrong (not a 17-digit ID). The error message includes a correction hint.

---

## IsThereAnyDeal v2

**What it provides:** current best prices across 30+ stores, historical all-time lows (ATL), discount percentages, and deal metadata. This is the core of the deal scoring pipeline.

**Auth:** `ITAD_API_KEY` env var. Free tier accounts have access to all endpoints used here. Register at [isthereanydeal.com/dev/app](https://isthereanydeal.com/dev/app/).

**Endpoints used:**

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/games/lookup/v1?appid={id}` | Resolve Steam App ID → ITAD game ID |
| `POST` | `/games/overview/v2` | Current price + ATL for up to 200 games |
| `POST` | `/games/prices/v3` | Per-store price breakdown for up to 200 games |
| `GET` | `/games/search/v1` | Title search |
| `GET` | `/deals/v2` | General deal feed |

**Rate limits:** ITAD publishes no hard rate limits. The client applies heuristic throttling: 200 ms between individual `/games/lookup/v1` GET requests (which don't support batching), and 500 ms between batch POSTs.

**Batch size:** `BATCH_SIZE = 200` — both `getOverview` and `getPricesV3` send up to 200 ITAD game IDs per POST request. A library of 600 wishlisted games sends 3 POST requests with a 500 ms pause between them.

**ID resolution:** Steam App IDs and ITAD game IDs are different namespaces. The sync pipeline resolves them once (stored as `itadGameId` on the game row) and only re-resolves games that are missing the mapping. The lookup endpoint is GET-only, so this step is always serial.

**Price sync scope:** runs against all wishlisted and watchlisted games on every scheduled run. There's no staleness guard — if a game is on your wishlist or watchlist, it gets a fresh price snapshot every cycle.

**Default schedule:** every 12 hours (`CRON_PRICE_CHECK`, default `0 */12 * * *`).

**Gotchas:**

- Without `ITAD_API_KEY` the price sync throws immediately. No prices means no deal scores, no ATL comparisons, and no price alerts.
- Some Steam games have no ITAD listing (niche titles, regional exclusives). These stay with `itadGameId = null` and appear in the UI with no price data.
- ITAD prices are in USD by default. The `getPricesV3` method accepts a `country` param (defaults to `'US'`).

---

## HowLongToBeat

**What it provides:** three duration estimates per game — Main Story (`gameplayMain`), Main + Extras (`gameplayMainExtra`), and Completionist (`gameplayCompletionist`), all in decimal hours. These feed directly into the $/hour value score.

**Auth:** none. HLTB has no official API and no API key.

**The mechanism:** HLTB's site is a Next.js app. The client reverse-engineers its search API at runtime:

1. Fetches the HLTB homepage and scans all `/_next/*.js` bundles for a `fetch()` call with `method: "POST"` to `/api/{something}`.
2. Hits `{discovered_path}/init?t={timestamp}` to get an auth token plus fingerprint parameters (`hpKey`/`hpVal`).
3. POSTs searches to the discovered path with `x-auth-token`, `x-hp-key`, and `x-hp-val` headers, plus `hpKey`/`hpVal` embedded in the request body.

Auth state is cached in module-level variables and refreshed every 5 minutes (`AUTH_TTL_MS = 5 * 60 * 1000`). The fallback search path is `api/finder/` if discovery fails. On a 401/403/404 response, the client invalidates the cache and retries once with fresh auth.

**Title normalization:** game titles from Steam often don't match HLTB's catalog directly. The client runs three search attempts in order before giving up:

1. Original title (cleaned of trademark symbols and special characters)
2. Edition-normalized title — strips suffixes like "Deluxe Edition," "GOTY," "Enhanced," "Remastered," and parenthetical years like `(2009)`
3. Subtitle-stripped title — keeps only the part before the first colon, provided the prefix is at least 8 characters (avoids searching for stubs like "Re:" or "FF:")

A result must clear a similarity score of 0.4 (computed as a character-overlap ratio against the cleaned search term) to be accepted.

**Batch behavior:** `batchSearch` processes one title at a time with a default 1,500 ms delay. The HLTB sync job processes up to 100 games per run (`BATCH_SIZE = 100` in `src/lib/sync/hltb.ts`).

**Stale threshold:** HLTB data refreshes after 90 days. Games that were searched but not found get a backoff: miss count 0–2 retries after 7 days, 3–4 after 30 days, 5–7 after 90 days, 8+ are skipped indefinitely.

**Default schedule:** twice a week, Sunday and Wednesday at 2:00 am (`CRON_HLTB_SYNC`, default `0 2 * * 0,3`).

**Fragility:** this is the most fragile source — see [Design decisions](/design-decisions/#custom-hltb-client) for the why. HLTB can break with any of these changes:

- The search path changes in the JS bundle (the discovery regex would need updating)
- The `init` endpoint moves or changes its response shape
- HLTB adds bot detection that the current User-Agent spoof doesn't clear
- The response JSON shape (`json.data`, `comp_main`, `comp_plus`, `comp_100`) changes

The API returns durations in seconds; the client converts to hours before storing. If HLTB is down or returns garbage, the sync logs a warning and the game keeps whatever duration it had before (or none). The scoring engine returns a neutral value score of 50 when HLTB hours are null or zero.

**Request timeout:** 15,000 ms (`REQUEST_TIMEOUT_MS`).

---

## Discord webhooks

**What it provides:** outbound notifications only. Hoard sends messages to Discord channels via webhook POSTs — there's no bot, no inbound commands, no event subscription.

**Auth:** one or two webhook URLs, both optional:

| Env var | Purpose |
|---|---|
| `DISCORD_WEBHOOK_URL` | Deal alerts channel |
| `DISCORD_OPS_WEBHOOK_URL` | Ops alerts channel (sync failures, backup failures, weekly health summary) |

If `DISCORD_OPS_WEBHOOK_URL` is not set, ops alerts fall back to the main `DISCORD_WEBHOOK_URL`. Both are read from config at send time, so you can update them in Settings without restarting.

See [Discord alerts](/features/alerts/) for alert types, throttle behavior, and what each embed looks like. A short summary below.

**Message types:**

- **New ATL alert** — sent individually per game; green embed. Fires when a watched game's current price is at or below its historical low.
- **Free game alert** — individual, purple embed. Fires when a watched game is free.
- **Still-at-ATL digest** — a single gray embed listing all watched games that remain at their existing ATL. Keeps one message from becoming dozens when prices haven't changed.
- **Release notification** — blue embed when a tracked unreleased game becomes available.
- **Operational alert** — red embed to the ops channel. Fires on sync task failure. Includes recent run history for context.
- **Backup failure** — ops channel only. Backup success notifications are suppressed to avoid noise.

**Alert throttle:** `ALERT_THROTTLE_HOURS` (default: 24) is the minimum time between alerts for any single game. Checked before sending both individual ATL alerts and ATL digest entries.

**Reliability:** no retry logic. A failed POST logs an error and returns `false`; the calling code handles the return value but does not re-queue. The webhook request times out after 10,000 ms. If the webhook URL is empty, the send is skipped silently.

---

## If you omit a source

**No Steam key** — the app has nothing to work with. Library and wishlist sync both fail immediately. The game detail pages have no data to show.

**No ITAD key** — price sync throws on startup. No price data means no deal scores, no ATL tracking, and no price alerts. The backlog and library pages still work, but without deal indicators.

**No HLTB data** — the value score loses the $/hour axis. The scoring engine returns 50 (neutral) for any game without duration data. Deal scores still compute from price-to-ATL and review percentage.

**No Discord webhook** — notifications are silently skipped. All price tracking, alerts configuration, and sync scheduling continue to work normally.
