---
title: Changelog
description: A phase-by-phase feature history of Hoard, from initial Steam sync through polish plans and UI overhauls.
---

Hoard shipped in focused phases, each with a clear scope before moving on. This page walks through what each phase delivered — useful context if you're returning after a while or want to understand how the project evolved.

## Phase 1: Foundation and Steam integration

The first phase established the skeleton: Next.js App Router, SQLite via Drizzle ORM, Docker Compose, and Steam Web API authentication. Library and wishlist data synced from Steam by API key, with playtime included. The game list was searchable and sortable. A game detail page showed Steam metadata and review scores. A Settings page wired up API key configuration. Everything was intentionally minimal — the goal was a working shell to build on.

## Phase 2: Price intelligence

Phase 2 introduced [IsThereAnyDeal](https://isthereanydeal.com) (ITAD) as a price source, pulling current prices across 30+ stores and historical all-time lows. Deal quality indicators surfaced the gap between current price and ATL. Price data snapshotted on a schedule, giving the app a growing history to work with. The game detail page gained a price comparison view. loaded.com and Eneba link-outs were added as grey market references where no direct API exists.

## Phase 3: Duration and value scoring

HowLongToBeat integration came next, feeding community-averaged play-time estimates into a $/hour calculation for every game. The [value scoring engine](/architecture/scoring-engine/) combined price-to-ATL ratio, Steam review percentage, $/hour relative to per-tier thresholds, and personal interest rating into a single configurable score. Weights are user-adjustable. HLTB data backfilled across the existing library on first run, and deal scores appeared on game cards and the detail page.

## Phase 4: Backlog recommender

The backlog view let you filter unplayed and underplayed games by duration, genre, tags, and co-op support. A "pick for me" button selected randomly from whatever filters were active. A "date night" preset pre-configured co-op plus short duration. Unplayed and underplayed games were highlighted separately to make the queue feel manageable.

## Phase 5: Alerts and Discord

Phase 5 wired up the watchlist and notification layer. You can flag any game, set a price threshold, and configure notify-on-ATL. A cron task chains off the price sync, evaluates active watchlist entries against fresh snapshots, and sends Discord webhook notifications. A dedicated `/watchlist` page showed the full table. Settings gained alert throttle configuration and a test webhook button.

## Phase 6: PWA and mobile-responsive layout

The app became installable as a PWA via `@serwist/turbopack` with a service worker. The layout shifted to fully responsive: a bottom tab bar on mobile, card layouts that reflow at narrow widths, and touch targets sized to 44px minimums. The desktop sidebar gained collapsible icon-only mode with tooltip labels, persisted to localStorage.

## Polish plans (1-6)

Six plans ran after the main phases, each addressing a class of production concerns.

Automated backups used `better-sqlite3`'s `.backup()` for WAL-safe atomic copies, with configurable retention and a daily cron schedule. Security hardening added Zod validation on all inputs, rate limiting, and security headers. A Vitest testing infrastructure shipped with 208+ tests across 11 files. Authentication arrived via Better Auth with credentials-based login — sessions stored in the same SQLite database. A DRY pass extracted shared patterns: an SSE utility, `useApiMutation`, and consistent API helpers. Observability closed out the batch: a health endpoint, Discord ops alerts for sync failures, a sync history view, and a stale-data banner when cached data ages past a threshold. The [demo mode](/demo/) layer was also built here, with read-only mutation blocking and a sanitized seed database.

## UI overhaul plans (7-12)

A round of UI-focused plans tightened the data quality and visualization layers.

The wishlist revamp added data completeness filtering, an `isReleased` flag, a `DataStatus` indicator, and store links per game. Price visualization introduced an interactive Recharts area chart with best-price-per-day aggregation and a time range selector. The backlog received strict filter logic, a smart score threshold, a mood picker, and a slot machine animation for "pick for me." The settings UI split into sub-pages with a header user menu and mobile sign-out flow. Enrichment observability added shared `SyncStats` types, per-game error isolation during sync, success rate alerting, and a weekly health summary digest sent to Discord.

## Feature plans

Plan 15 added wishlist game removal: local removal with a sync guard, Steam-source-of-truth auto-removal on re-sync, and cascade deactivation of related alerts. Plan 16 split unreleased games into a dedicated `/releases` page with nav overhaul, release date parsing, release status sync, and Discord notifications for newly-released titles. A filters pass added price and free game filters, an interest filter, default sort order on wishlist, an auto-alerts button, and a dynamic version string. Plan 25 replaced pagination with infinite scroll across Library, Wishlist, and Backlog using `IntersectionObserver`, skeleton loading states, scroll restoration, and a fetch-on-click model for "pick for me." The dashboard overhauled to include a genre bar chart, deal score histogram, and an activity feed, all via Recharts.

Smart Discord notifications tightened the alert signal: new all-time lows send individual messages, while games that are still at ATL from a previous alert are batched into a digest, reducing noise significantly.

Automatic price history backfill turned a manual button into a nightly enrichment job: 100 games per run at ~60 requests per minute, scoped to owned/wishlisted/watchlisted games with a resolved ITAD ID, stamped per-game so already-enriched games are skipped on later runs. A drain-mode wrapper (`primePriceHistory`) loops batches until empty for future onboarding flows, scoped per user to avoid horizontal authz gaps. The job is wired into the existing Discord health alerts and the weekly summary digest.

## Configurable notifications

Notifications were unified behind a single dispatcher. Until now deal alerts only ever reached Discord, which became a problem once the onboarding overhaul made Discord optional — skip the webhook and you got no deal alerts at all, despite that being the whole point of the app. Every notification now flows through one path that fans out to the in-app bell and Discord independently, so the bell is always a complete record and Discord is a channel you opt into rather than depend on.

A new Settings → Notifications page exposes the controls. A routing matrix decides, per category — individual deals, the still-at-ATL digest, releases, milestones, and system alerts — whether each lands in the bell, on Discord, or both. Routing the individual-deal and digest rows separately means you can keep loud per-deal pings on Discord while the digest collects quietly in the bell, or mute the individual row entirely for a digest-only experience. The per-game throttle moved here from the Alerts page. Quiet hours pause Discord deal pings during a nightly window — evaluated in the server's timezone — while the bell keeps recording silently, so nothing is missed; milestones and system alerts are never paused. Releases, Early Access graduations, backup failures, and the first-deal and first-ten-rated milestones now surface in the bell too, where before they were Discord-only.

## Value-data polish

A feedback round after the Value Received launch tightened how owned-game value is shown and put the new data to work. The scoring engine stopped inventing a value tier when it had no honest baseline: a game with no HowLongToBeat estimate *and* no recorded price used to fall back to raw playtime hours, which mislabeled a 15-minute game as "Approaching" and a 100-hour sandbox as "Exceeded." Both now show a neutral "Played Xh" chip until you add a duration or a price — the same honesty-over-compulsion stance the price-paid suggestions take.

In-app notifications got more useful: clicking a deal alert now opens the game's detail page (where the price history, value breakdown, and store links live) instead of jumping straight to the store, and the still-at-ATL digest opens a modal listing every game in it — each linking to its detail page — rather than dumping you on the wishlist.

The dashboard gained a Value Received donut (owned games by tier) and a Spending & Value tile (total spent, hours played, blended $/hour, and how often you reached expected value), plus a Most Value Waiting card. The Library added four value sorts — Value Received tier, Realized $/hour, Completion %, and Price Paid — and the Backlog now defaults to its Most Value Waiting sort and offers it directly in the sort menu.

## Onboarding wizard

The onboarding wizard at `/onboarding` walks a new self-hoster through initial setup — Steam API key, Steam user ID, ITAD key, and Discord webhook — with live validation at each step. Behind the scenes, a drain orchestrator runs Steam library, HLTB, and price-history backfill in the background so the library is populated before the wizard closes. A dashboard progress checklist surfaces remaining setup steps after the wizard completes, and sync-status banners appear when the drain is still running.

## Enjoyment rating and verdict

The "Was it worth it?" verdict on owned-game detail pages now leads with an explicit enjoyment rating (1–5 stars) rather than deriving intent from playtime alone. When a rating is recorded, the value-received breakdown shows a warm summary line based on the gap between expected enjoyment (predicted from review tier) and the actual rating — "Paid off exactly as expected," "Pleasant surprise," or "Didn't land as hoped" with a one-line explanation. The $/hr calculation stays visible as supporting context. Unrated games fall back to the time/money lens described in the Value Received section. A `/triage?view=value` view lets you backfill ratings across your library.
