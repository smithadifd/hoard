---
title: Demo mode
description: The public demo at hoard.smithadifd.com — what it does, how it's sanitized, and how to add new endpoints to the block list.
---

## Try the live demo

**[hoard.smithadifd.com](https://hoard.smithadifd.com)**

Sign in with `demo@example.com` / `demo1234!`. The demo is read-only — you can explore every page and UI feature, but no data will change. The database resets every Sunday at 4am UTC.

## What demo mode does

When `DEMO_MODE=true` is set, the app changes in six ways:

- A banner appears at the top of every page identifying the session as a demo
- The login page shows the demo credentials directly
- Mutation endpoints return `403` — no syncing, no settings changes, no alert management (full list below)
- The scheduler skips all cron task registration — no background jobs run
- The Settings page hides API key fields and replaces sync buttons with a "disabled in demo mode" notice
- Sessions expire after 24 hours instead of the standard 30 days

The 24-hour expiry is set in `src/lib/auth.ts`: when `DEMO_MODE === 'true'`, `expiresIn` is `60 * 60 * 24` instead of `60 * 60 * 24 * 30`.

The scheduler check is in `src/lib/scheduler/index.ts`: `registerTask()` returns early if `process.env.DEMO_MODE === 'true'`, so no tasks are ever registered.

## What you can do in the demo

The demo container serves real sanitized data from a production export:

- Browse the library, wishlist, backlog, and releases pages with actual game records
- Open any game detail page to see price history charts, deal score breakdowns, and HLTB data
- Use the backlog recommender — mood picker, filters, and the "pick for me" randomizer all work
- View the dashboard charts (genre distribution, deal score histogram, activity feed) built with Recharts
- Explore the scoring engine's output across the full catalog

No API calls leave the container. There are no `STEAM_API_KEY`, `ITAD_API_KEY`, or Discord webhook credentials in the demo environment.

## How the data is sanitized

The demo database is a snapshot of a real production database with personal data stripped. `scripts/export-demo-db.mjs` does the work:

1. Copies the source database to `data/demo/demo-seed.db`
2. Deletes all rows from `session`, `account`, `user`, and `verification`
3. Deletes all rows from `settings` (which holds API keys), `sync_log`, and `price_alerts`
4. Updates every row in `user_games`: clears `notes`, resets `personal_interest` to 3, nulls `price_threshold`, `interest_rated_at`, `wishlist_removed_at`, and `last_auto_alert_at`, and sets `is_watchlisted = 0` and `auto_alert_disabled = 0`
5. Runs `VACUUM` to reclaim space

The result ships inside the Docker image. `scripts/seed-demo.mjs` runs on startup to create the demo user account (`demo@example.com` / `demo1234!`) and link the `user_games` rows to it. If the demo user already exists, seeding is a no-op.

The CLAUDE.md notes the snapshot as approximately 538 games and 15,000 price snapshots. The export script prints actual counts each time it runs.

## Deployment

The demo runs on AWS EC2 behind CloudFront with geo-restriction (US and Canada). The compose file is `docker-compose.demo.yml`:

- Port mapping: `3011:3000`
- Memory limit: 300M
- `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true` set in the environment
- Health check: `GET /api/health` every 60 seconds

An EC2 cron job polls the `main` branch every 5 minutes and rebuilds if a new commit is detected. A second cron job deletes the data volume and restarts the container every Sunday at 4am UTC, which triggers the seed script to re-apply the bundled `demo-seed.db`.

Rebuild the demo database from a fresh production snapshot:

```bash
node scripts/export-demo-db.mjs ./data/hoard.db
# then rebuild the Docker image so demo-seed.db is bundled
docker compose -f docker-compose.demo.yml build
```

## Adding a new mutation endpoint to the block list

Any new route that changes data must be added to `DEMO_BLOCKED` in `src/proxy.ts`. The current list:

| Method | Prefix |
|---|---|
| `POST` | `/api/sync` |
| `POST` | `/api/steam` |
| `POST` | `/api/prices` |
| `POST` | `/api/backup` |
| `PUT` | `/api/settings` |
| `PATCH` | `/api/settings` |
| `POST` | `/api/setup` |
| `POST` | `/api/alerts/test` |
| `PATCH` | `/api/games` |
| `POST` | `/api/games` |
| `POST` | `/api/alerts` |
| `PATCH` | `/api/alerts` |
| `DELETE` | `/api/alerts` |

The proxy checks method and path prefix. A blocked request returns:

```json
{ "error": "This action is disabled in demo mode." }
```

with status `403`. Add new entries in the same `{ method, prefix }` shape before the closing `]` of the `DEMO_BLOCKED` array.

## Running demo mode on your own deployment

Set `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true` in your environment. This is intended for sharing a read-only view with others (family link, portfolio, etc.) without exposing your API keys or allowing sync operations. You will still need a database — either export your own with `export-demo-db.mjs` or start from scratch. No other configuration changes are required.
