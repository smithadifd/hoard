---
title: Discord alerts
description: How Hoard sends price alerts and ops notifications to Discord — watchlist setup, alert types, throttling, and webhook configuration.
---

Hoard sends price notifications to Discord when a watched game hits a threshold or reaches its all-time low. There are two webhook targets: one for deal alerts, one for operational events. Neither is required — if neither is configured, notifications are skipped silently.

For basic webhook setup (creating the URL in Discord, setting the env vars), see [Self-hosting](/self-hosting/). This page covers how alerts work once the webhooks are in place.

## Webhook targets

Two env vars control where notifications go:

| Variable | Purpose |
|---|---|
| `DISCORD_WEBHOOK_URL` | Price alerts — new ATLs, threshold hits, free games, and the still-at-ATL digest |
| `DISCORD_OPS_WEBHOOK_URL` | Operational alerts — sync task failures, weekly health summary |

If `DISCORD_OPS_WEBHOOK_URL` is not set, ops alerts fall back to `DISCORD_WEBHOOK_URL`. If neither is set, all notifications are dropped without error. Both can also be set through Settings → Notifications in the UI, where the DB value takes priority over the env var at runtime.

See [Configuration](/self-hosting/configuration/) for the full variable reference.

## Alert types

The alert checker (`src/lib/sync/alerts.ts`) splits notifications into two tiers to reduce noise.

### Individual alerts

Sent as a standalone Discord embed per game. Triggers when any of the following is true:

- The game is currently free (100% discount)
- The current price is at or below a manually set target price
- The game has hit a **genuinely new** all-time low — meaning the current historical low is lower than the last recorded historical low

The "genuinely new ATL" distinction matters. If a game has been sitting at its ATL for weeks, re-alerting every price sync run would be noisy. The `isNewAtl` function compares the current historical low against `prevHistoricalLowPrice` stored from the previous snapshot: if the new low is strictly less than the previous, it's a new record and gets an individual alert.

### Digest

Games that are at their ATL but haven't set a new record are batched into a single "Still at All-Time Low" embed. All of them arrive in one message. This keeps the deal channel readable when several watchlisted games are on sale simultaneously.

The digest is a **once-daily reminder**, sent independently of the price-check cadence. Price checks still run on `CRON_PRICE_CHECK` (every 12h by default), so genuinely new ATLs and free/threshold hits fire individually as often as that — but the still-at-ATL list is consolidated to the first run on or after the configured digest hour each day. That hour is set in **Settings → Notifications** ("Daily deals summary at"), evaluated in the server's timezone (the same reference quiet hours use); it defaults to `12` (≈ 8 AM US Eastern on the default UTC container) and can also be seeded with the `ATL_DIGEST_HOUR` env var. A `last_atl_digest_date` setting deduplicates the send so an off-cycle run later the same day doesn't repeat it.

This is deliberate: with a 12h check and a 24h throttle, still-at-ATL games used to ping in *alternating* runs, so two consecutive digests were near-disjoint half-lists and the count swung wildly. Decoupling the digest gives one complete, stable list per day. Because the daily window is what limits digest frequency, the per-game throttle is **not** applied to digest entries — every game that is still at its ATL appears in each day's digest, even if it was individually alerted earlier.

The still-at-ATL digest embed is gray (`0x6b7280`) to distinguish it visually from the green (`0x22c55e`) individual ATL alerts.

### Burst condensing

The once-daily digest above only batches games *still* sitting at a known low. Genuinely **new** ATLs normally fire individually and bypass the throttle — correct on a normal day, but during a major sale (e.g. Steam's seasonal sale) a single price-check run can produce dozens of new ATLs at once, flooding the in-app bell (which shows the most recent 20) and the deal channel.

To handle this, a single run that produces **`atl_burst_threshold` or more** new ATLs (default `8`, tunable via the `atl_burst_threshold` setting) collapses them into one summary instead — a "Just Hit All-Time Low" digest delivered on **both** channels (in-app + Discord). The rationale is that a burst of new ATLs in one run is a *correlated event* (the sale), not N independent ones. The burst embed is green (`0x22c55e`) to match the new-ATL accent, distinct from the gray still-at-ATL roundup.

Free games and explicit **threshold hits are never condensed** — they're rare and high-signal (a giveaway, or a price *you* set), so they always ping individually even mid-burst. Each condensed alert still records its own `lastNotifiedAt`, so per-game throttle/dedup is unaffected; the next run won't re-fire. Below the threshold, new ATLs ping individually as before.

## Auto-ATL alerts

In addition to the manual watchlist, Hoard can automatically alert on any wishlisted game that reaches its all-time low and has a deal score of 55 or above. This is controlled by the `auto_atl_deal_alerts` setting (Settings → Notifications), which defaults to enabled. The same individual-vs-digest split applies: genuinely new ATLs and free games get individual alerts; games still sitting at a known ATL go into the digest.

## When alerts run

The alert checker runs automatically after every price sync. `syncPrices` in `src/lib/sync/prices.ts` calls `checkPriceAlerts` via dynamic import once the price snapshot phase completes. If the alert check throws, the error is logged but the price sync itself is not marked failed.

The default price sync schedule is every 12 hours (`CRON_PRICE_CHECK`, default `0 */12 * * *`), so alerts fire at most twice a day under normal circumstances. The throttle setting adds a further per-game limit on top of that.

See [Architecture](/architecture/) for the full scheduler chain.

## Throttle and deduplication

`ALERT_THROTTLE_HOURS` (default: `24`) sets the minimum gap between **individual** notifications for the same game. Before queuing an individual alert, the checker reads `lastNotifiedAt` from the alert record and computes how many hours have passed. If fewer than `alertThrottleHours` hours have elapsed, the alert is skipped and counted as throttled. A genuinely new ATL bypasses the throttle (it's fresh news). The throttle does **not** gate digest entries — those are limited by the once-daily digest window (the configurable digest hour) instead, so the daily list stays complete.

The throttle applies independently to explicit watchlist alerts and auto-ATL alerts — each has its own `lastNotifiedAt` tracking column.

To change the default, set `ALERT_THROTTLE_HOURS` in your env file or update it through Settings → Notifications. The Settings value takes priority over the env var.

## What the embed contains

Individual price alert embeds include:

- Title linking to the store page
- Price field: original price struck through, current price, discount percentage
- Historical low
- Store name
- $/hour (if HLTB duration data is available for the game)
- Review description (e.g., "Very Positive") if present
- Deal score (rated Excellent / Great / Good / Okay) if available

The digest is a single embed listing each game as a hyperlinked line with price and store.

## Setting up the watchlist

The `/watchlist` page lists all games you've flagged for price alerts, with active count and a count of alerts triggered in the past week.

To add a game to the watchlist, go to its detail page and enable the watchlist toggle. From there you can set:

- A **target price** — alert when the price drops to or below this value
- **Notify on all-time low** — alert when the game hits its ATL (subject to the individual-vs-digest classification above)

The `/watchlist` page lets you review and edit all of your alert configurations in one place. To remove a game, disable both notification options or delete the alert from the watchlist table.

## Testing the webhook

Settings → Notifications has a "Send test notification" button. It calls `POST /api/alerts/test`, which sends a test embed to `DISCORD_WEBHOOK_URL`. If the webhook URL is not configured, the endpoint returns a validation error instead of attempting the send. The test does not use the ops webhook.

## Ops alerts

Operational alerts go to `DISCORD_OPS_WEBHOOK_URL` (falling back to `DISCORD_WEBHOOK_URL` if unset). They are sent by the scheduler when a cron task throws an unhandled error — the embed includes the task name, schedule, error message, and recent run history for context.

A weekly health summary also goes to the ops channel every Monday at 9 am (hardcoded, no env var override). Backup failures send to the ops channel as well; successful backups do not generate a notification.
