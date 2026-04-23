---
title: Hoard
description: Self-hosted game deal tracker and backlog manager with $/hour value scoring.
---

Hoard is a self-hosted web app for tracking game deals, managing your Steam library and backlog, and deciding what to play next.

The problem it solves: games go on sale constantly across 30+ stores, review quality varies wildly, and a cheap game you'll never finish is a worse deal than a pricier one you'll sink 80 hours into. Hoard pulls together prices from [IsThereAnyDeal](https://isthereanydeal.com), play-time estimates from HowLongToBeat, and Steam review data, then combines them into a single configurable deal score.

**Project status:** all phases and polish plans complete.

## Live demo

[hoard.smithadifd.com](https://hoard.smithadifd.com) — sign in with `demo@example.com` / `demo1234!`. Demo mode is read-only: mutations are blocked and data resets weekly.

## What it does

- Imports your Steam library and wishlist on a schedule
- Monitors prices across stores via IsThereAnyDeal API v2, with historical lows and deal-quality indicators
- Scores every deal using configurable weights: price-to-ATL ratio, Steam review percentage, $/hour relative to review-tier thresholds, and your personal interest rating (1-5)
- Surfaces backlog picks by mood, duration, co-op support, and play history — with a "pick for me" randomizer
- Sends Discord notifications when watched games hit price thresholds; distinguishes new all-time lows from still-at-ATL digests to reduce noise
- Installable as a PWA with a responsive mobile layout

<!-- Dashboard screenshot placeholder. Capture from the running app and commit to docs/src/assets/dashboard.png, then restore an image reference here. -->

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, React 19 |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | Better Auth (credentials-based) |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Price data | IsThereAnyDeal API v2 |
| Play-time data | HowLongToBeat (unofficial package) |
| Notifications | Discord Webhooks |
| Scheduling | node-cron (in-process) |
| Testing | Vitest |
| Deployment | Docker Compose, Synology NAS + Caddy reverse proxy |

## How the architecture works

All external data syncs into SQLite on a schedule. The UI reads exclusively from the database — no live API calls at render time. Pages stay fast and keep working during API outages.

```
Steam API  --> sync --> SQLite <-- UI
ITAD API   --> sync --|
HLTB       --> sync --|
```

The value scoring engine lives in `src/lib/scoring/`. Weights are user-configurable through the Settings page and stored in the `settings` table. Cron tasks run in-process via node-cron — no separate worker container.

## Where to next

- [Self-hosting](/self-hosting/) — Docker setup, environment variables, NAS deployment
- [Architecture](/architecture/) — data flow, service layer, scoring engine, cron design
- [Features](/features/) — a tour of every page: Dashboard, Library, Wishlist, Releases, Backlog, Watchlist
- [Data sources](/data-sources/) — Steam, ITAD, HLTB, Discord — what each provides and the quirks to know
- [Design decisions](/design-decisions/) — why SQLite, in-process cron, cache-first reads, and other tradeoffs
