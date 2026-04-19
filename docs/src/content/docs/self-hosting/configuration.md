---
title: Configuration
description: Environment variables reference for Hoard — required, recommended, and tuning options.
---

Environment variables are loaded from `.env.local` in development or `.env.production` in production. Copy `.env.example` to get started — never commit either file to git. A few variables (anything prefixed `NEXT_PUBLIC_`) are inlined at Docker build time by Next.js, not at container startup, so they must be present during the build step.

API keys for Steam and ITAD can also be set through the Settings page in the UI; those database values take priority over environment variables at runtime.

## Required variables

The app will start without these, but `validateConfig()` logs them as missing and Steam syncs will fail immediately.

| Variable | Description | Example |
|---|---|---|
| `STEAM_API_KEY` | Steam Web API key. Required for all Steam syncs. Get one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). | `A1B2C3D4E5F6...` |
| `STEAM_USER_ID` | Your Steam64 ID. Find it at [steamid.io](https://steamid.io). | `76561198012345678` |
| `BETTER_AUTH_SECRET` | Secret key used to sign and encrypt sessions. Generate with `openssl rand -base64 32`. | `abc123...` |

## Recommended variables

The app runs without these, but meaningful features are unavailable.

| Variable | Description | Default | Notes |
|---|---|---|---|
| `ITAD_API_KEY` | IsThereAnyDeal API key. Required for price data, historical lows, and deal scoring. Register at [isthereanydeal.com/dev/app](https://isthereanydeal.com/dev/app/). | _(none)_ | Without this, price pages are empty. |
| `DISCORD_WEBHOOK_URL` | Discord webhook for price alert notifications. | _(none)_ | Creates a webhook under Server Settings → Integrations. |
| `DISCORD_OPS_WEBHOOK_URL` | Separate Discord webhook for ops alerts (sync failures, health summaries). | _(none)_ | Falls back to `DISCORD_WEBHOOK_URL` if unset. |
| `NEXT_PUBLIC_APP_URL` | Public URL of your Hoard instance. Used by the auth client and session cookies. | `https://hoard.home` | Must be set at **build time** for Docker. See [build-time variables](#build-time-variables) below. |
| `BETTER_AUTH_URL` | Base URL for better-auth. Falls back to `NEXT_PUBLIC_APP_URL`, then `http://localhost:3000`. | _(falls back)_ | Usually the same as `NEXT_PUBLIC_APP_URL`. Set explicitly if they differ. |
| `TRUSTED_ORIGINS` | Comma-separated additional origins the auth layer will accept (e.g. your reverse proxy hostname). | _(none)_ | `http://localhost:3000` is always trusted. |

## Optional tuning

All of these have working defaults. Override them if the defaults don't fit your schedule or storage constraints.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Path to the SQLite database file. | `./data/hoard.db` |
| `ALERT_THROTTLE_HOURS` | Minimum hours between price alert notifications for the same game. | `24` |
| `BACKUP_RETENTION_DAYS` | How many days of backup files to keep before auto-deletion. | `30` |
| `CRON_PRICE_CHECK` | Cron schedule for checking prices. | `0 */12 * * *` |
| `CRON_LIBRARY_SYNC` | Cron schedule for syncing your Steam library and wishlist. | `0 3 * * *` |
| `CRON_WISHLIST_SYNC` | Cron schedule for syncing wishlist-only data. | `0 1 * * *` |
| `CRON_HLTB_SYNC` | Cron schedule for HowLongToBeat enrichment. | `0 2 * * 0,3` |
| `CRON_REVIEW_SYNC` | Cron schedule for refreshing Steam review scores. | `0 4 * * 2,5` |
| `CRON_BACKUP` | Cron schedule for automatic database backups. | `0 4 * * *` |

Cron expressions follow standard five-field syntax (`minute hour day-of-month month day-of-week`).

## Build-time variables

Next.js inlines `NEXT_PUBLIC_*` variables at build time. If you set them in your `.env.production` file but don't pass them as Docker build arguments, the running container will see the defaults baked into the image — not what's in your env file.

**`NEXT_PUBLIC_APP_URL`** is the one you're most likely to need. Pass it as a build arg:

```dockerfile
docker build --build-arg NEXT_PUBLIC_APP_URL=https://hoard.home .
```

Or in `docker-compose.prod.yml`:

```yaml
build:
  args:
    NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL}
```

**`NEXT_PUBLIC_APP_VERSION`** is set automatically from `package.json` at build time by `next.config.ts`. You don't set this yourself.

**`NEXT_PUBLIC_DEMO_MODE`** controls client-side demo UI. See [demo mode flags](#demo-mode-flags) below.

## Demo mode flags

Two variables control demo mode. You don't need either for a normal self-hosted install.

| Variable | Description |
|---|---|
| `DEMO_MODE` | Set to `true` to block all mutation endpoints (sync, settings, alerts), disable cron tasks, and shorten sessions to 24 hours. Runtime variable. |
| `NEXT_PUBLIC_DEMO_MODE` | Set to `true` to show demo credentials on the login page and disable settings fields in the UI. Build-time variable — must be passed as a Docker build arg. |

Both must be `true` for a fully working demo deployment. Setting only `DEMO_MODE` blocks mutations server-side but leaves the UI unchanged.

For full details on the demo deployment setup, see the Demo mode page.
