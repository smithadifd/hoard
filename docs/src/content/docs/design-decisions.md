---
title: Design decisions
description: The interesting tradeoffs behind Hoard's architecture — SQLite, in-process cron, cache-first reads, custom HLTB client, Better Auth, and more.
---

This is the "why" page. If you're returning after a few months and want to reload context, or you're evaluating whether the architecture makes sense before self-hosting, this covers the reasoning behind the non-obvious choices. For the "what" — data flow, tables, the scheduler — see [Architecture](/architecture/).

## SQLite instead of Postgres

A single-file database is the right fit for a self-hosted NAS app where you control the machine and there's one user. No container to manage, no auth to configure, no connection pooling. Backups are a `cp` or `.backup()` call. The Drizzle ORM layer abstracts the SQL dialect, so swapping to Postgres later is a schema migration and a driver swap, not a rewrite.

The real tradeoff is concurrency. SQLite has a single writer. In practice this never bites — sync jobs run serially, WAL mode is enabled for concurrent reads, and there are no background write storms. If Hoard ever grew to multi-user or multiple write-heavy processes, the single-writer limit would become a real bottleneck and Postgres would be the right answer.

**Revisit signal:** multi-user support, or any design that requires simultaneous writes from separate processes.

## In-process cron with node-cron

Price checking, library sync, HLTB backfill, and health summaries all run as cron tasks inside the Next.js process via node-cron. There's no separate worker container or message queue. One `docker-compose.yml`, one container, one process to monitor.

The tradeoff is coupling. If the web process crashes, the scheduler goes with it. Long-running sync tasks also run on the same event loop — they're async and yield regularly, so in practice the app stays responsive, but there's no isolation between web traffic and background work. The scheduler guards against concurrent runs of the same task (if a task is still running when its next tick fires, it skips). Failed tasks send a Discord ops alert and never crash the scheduler.

**Revisit signal:** tasks that require true isolation (ML enrichment, heavy compute), or a design where the scheduler needs to survive a web process restart independently.

## Cache-first reads

The UI reads exclusively from SQLite. There are no live API calls at render time — not to Steam, ITAD, or HLTB. Every external data fetch goes through a sync job that writes to the database first. Pages load fast and keep working during API outages.

The cost is freshness. Prices sync on a schedule (default: every 12 hours), so price data on screen can be up to 12 hours old. Users can trigger a manual sync from Settings for near-real-time data, but the UI doesn't auto-refresh from external sources. If you're making a time-sensitive purchase decision, hit the manual sync button.

**Revisit signal:** if sub-hour price accuracy matters, a webhook-based push model from ITAD would be the upgrade, not polling more aggressively.

## Custom HLTB client

The unofficial `howlongtobeat` npm package is broken — HLTB changed their API and the package was never updated. Rather than depend on a dead package, the client in `src/lib/hltb/client.ts` implements the protocol directly, following the approach from the working Python library.

The flow is: scrape the HLTB homepage to find the current Next.js JS bundle, extract the search endpoint path via regex, GET `{endpoint}/init?t={timestamp}` to obtain an auth token and fingerprint params (`hpKey`/`hpVal`), then POST a search with those headers and body params. Auth state is cached for 5 minutes and re-fetched on 401/403. The client also handles title normalization — stripping edition suffixes, parenthetical years, and subtitles after a colon — to maximize match rate against HLTB's catalog.

This is inherently fragile. If HLTB changes their JS bundle structure or auth scheme, the discovery step breaks. The app handles this gracefully: HLTB failures are caught per-game, the result is `null`, and the rest of the sync continues. A game without HLTB data just shows no duration and no $/hour score.

**Revisit signal:** if HLTB publishes an official API, or if the site structure changes frequently enough that maintaining the client becomes a regular chore.

## Better Auth over NextAuth or rolling auth manually

Hoard is a single-user app with credentials-based auth (email + password). Better Auth fit the requirements cleanly: it stores sessions in the same SQLite database via a Drizzle adapter, has good Next.js integration via `nextCookies()`, and doesn't require a separate auth service.

NextAuth v5 was also a candidate, but Better Auth's session model is simpler for this use case — no JWT rotation, just a session cookie backed by the database, with cookie-cached validation (5-minute TTL) to avoid a DB lookup on every request. Sessions expire after 30 days in production and 24 hours in demo mode. There are no OAuth providers configured because Hoard is personal infrastructure: you know your own email address.

Rolling auth manually would work but adds maintenance surface for no real gain at this scale.

**Revisit signal:** multi-user support, or if OAuth login becomes desirable (Google, GitHub, etc.).

## Steam + ITAD + HowLongToBeat as the data trinity

Each source covers a different axis:

- **Steam** owns library, wishlist, playtime, and review data. You're already bought into Steam; there's no better source for what you own and how much you've played it.
- **ITAD** (IsThereAnyDeal) aggregates prices from 30+ stores and maintains historical lows. No single store API covers this breadth.
- **HowLongToBeat** provides community-averaged play-time estimates. Without this, the $/hour score doesn't exist.

Three external dependencies means three failure modes, and none of them are within Hoard's control. The architecture isolates failures at the sync level — each source has its own sync job, its own error handling, and writes independently to the DB. A Steam outage doesn't affect price data; an HLTB outage doesn't affect your library. The UI degrades gracefully when data is missing rather than breaking.

See [/data-sources/](/data-sources/) for operational details on each API.

## Tailwind + shadcn/ui over an installed component library

shadcn/ui components are copied into the codebase rather than installed as a package dependency. The components live in `src/components/ui/` and can be modified freely. Theming is CSS variables in Tailwind config, not a proprietary theme API.

The tradeoff is ownership. When shadcn releases component updates you have to pull them manually rather than bumping a version. For a project with a stable, known design — which Hoard is — that's not a real cost. The benefit is that debugging a broken component means reading your own code, not digging through a `node_modules` black box. The design system uses Tailwind utility classes throughout, so visual behavior is always explicit.

**Revisit signal:** if the component surface grows large enough that tracking upstream shadcn changes becomes a maintenance burden.
