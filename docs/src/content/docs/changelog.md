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

## What's next

Two features are planned but not yet built: a post-purchase enjoyment rating (a two-field model tracking expected versus actual enjoyment, feeding into expected value metrics) and an onboarding wizard that walks through initial setup with background sync running in parallel.
