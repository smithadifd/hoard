---
title: Self-hosting guide
description: Prerequisites, Docker Compose setup, first-run steps, and port configuration.
---

Clone the repo, fill in a handful of environment variables, run one command, and Hoard is running. The steps below cover everything from zero to your Steam library showing up in the UI.

## Prerequisites

You need:

- **Docker** with Docker Compose — either the v2 plugin (`docker compose`) or the v1 CLI (`docker-compose`); commands below use the v1 syntax, but both work.
- **A Steam Web API key** — generate one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). You'll paste this into the onboarding wizard on first launch.
- **Your Steam64 ID** — look it up at [steamid.io](https://steamid.io) if you don't know it.
- **A public Steam profile** — Hoard reads your library and wishlist via the Steam Web API, which requires your profile and game details visibility to be set to Public. The wizard validates this in step 2 before letting you advance.
- **Port 3001 free** on the host (the production Compose file binds `3001:3000`).

Optional but worth having:

- **An IsThereAnyDeal API key** — register at [isthereanydeal.com/dev/app](https://isthereanydeal.com/dev/app/). Without this, price history and deal tracking are unavailable and the wizard hides the "Full" drain mode.
- **A Discord webhook URL** — for price alerts and onboarding milestone embeds. Create one under Server Settings → Integrations → Webhooks. A second webhook (`DISCORD_OPS_WEBHOOK_URL`) can receive operational alerts (sync failures, health summaries) separately from deal alerts; if omitted it falls back to the main webhook.

## Quick start

1. **Clone the repository.**

   ```bash
   git clone https://github.com/smithadifd/hoard.git
   cd hoard
   ```

2. **Copy the example env file.**

   For a production deployment:

   ```bash
   cp .env.example .env.production
   ```

   For local development:

   ```bash
   cp .env.example .env.local
   ```

3. **Fill in the required variables.** Open the file and set at minimum:

   ```
   STEAM_API_KEY=your_key_here
   STEAM_USER_ID=your_steam64_id
   BETTER_AUTH_SECRET=   # generate with: openssl rand -base64 32
   APP_URL=http://your-host:3001
   ```

   See [Configuration](/self-hosting/configuration/) for the full variable reference.

4. **Build and start the container.**

   ```bash
   docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```

   If `docker compose` (v2 plugin) isn't on the PATH — common on older Synology DSM — make sure the v1 CLI is reachable, e.g. `export PATH=/usr/local/bin:/usr/syno/bin:$PATH`. The image is built locally on first run; expect a few minutes.

5. **Walk the onboarding wizard.** Open `http://your-host:3001` in a browser. On first run Hoard redirects you through `/setup` (to create your admin credentials) and then to `/onboarding` — a seven-step wizard that:

   1. Sets expectations for how long the next ~15–60 minutes will look.
   2. Validates your Steam API key with a live `GetOwnedGames` call before letting you continue.
   3. Collects optional integrations (ITAD, Discord webhooks).
   4. Runs the initial Steam library + wishlist sync.
   5. Lets you pick a drain mode (see below).
   6. Streams drain progress with a "you can close this tab — we'll Discord you when it's done" callout.
   7. Lands you on the dashboard with onboarding bookkeeping stamped.

   You can re-enter the wizard later from **Settings → Onboarding** if you swap API keys or just want to re-run the drain.

## Dev vs prod compose files

`docker-compose.yml` is the development setup. It mounts the entire repo into the container and runs `npm run dev` with Turbopack. Use it for local development; not for anything exposed to a network.

`docker-compose.prod.yml` is the deployment file. It builds a multi-stage production image, applies a 512 MB memory limit, and maps host port `3001` to container port `3000`. Always use `--env-file .env.production` when running it — the file explicitly reads `${STEAM_API_KEY}`, `${BETTER_AUTH_SECRET}`, etc. from whichever env file you pass.

**`NEXT_PUBLIC_APP_URL` must be a build arg, not just a runtime env var.** Next.js inlines `NEXT_PUBLIC_*` variables at compile time. The Dockerfile accepts `NEXT_PUBLIC_APP_URL` as an `ARG` and bakes it into the bundle. If you only set it at runtime (e.g., via `docker run -e`), the value will be ignored. The production Compose file already wires this correctly — it passes `APP_URL` as a build arg under `services.app.build.args`. What you need to do is make sure `APP_URL` is set correctly in your env file before building.

## Reverse proxy

Hoard listens on port 3001 on the host. For TLS termination and a clean hostname, put Caddy or Nginx in front.

Minimal Caddyfile:

```text
hoard.home {
    reverse_proxy localhost:3001
}
```

If your reverse proxy is on a separate host, update `APP_URL` (and rebuild the image) to match the URL your users will actually hit. Also add that URL to `TRUSTED_ORIGINS` so Better Auth accepts session cookies from it:

```
TRUSTED_ORIGINS=https://hoard.yourdomain.com
```

## Drain modes

Step 5 of the wizard asks you to pick a drain mode. The drain orchestrator runs the enrichment pipeline up front so the dashboard has charts and scores within minutes, instead of waiting nights for cron to catch up. Pick based on how much patience you have on first launch:

| Mode | Stages | Library size estimate | When to pick it |
|---|---|---|---|
| **Full** | Price history → metadata → HLTB (capped at 300 games) → reviews | ~45 min for 500 games | You want the dashboard fully populated tonight. |
| **Lite** | Price history → metadata | ~12 min for 500 games | You want price charts now and are happy to wait for HLTB and reviews to fill in over the week. |
| **Cron-only** | _(no drain)_ | Instant | You'll let the scheduled cron tasks chew through the queue on their own. |

If the drain hits an upstream rate-limit it pauses for 24 hours and surfaces a banner; cron picks up the queue on its next firing. You can resume manually from **Settings → Onboarding → Run drain again**.

## What runs on cron after onboarding

The wizard's drain is a one-time accelerator. From then on, cron keeps everything fresh:

| Task | Default schedule |
|---|---|
| Library sync | 3 am daily |
| Wishlist sync | 1 am daily |
| Price check | Every 12 hours |
| HLTB sync | 2 am Sunday and Wednesday |
| Review enrichment | 4 am Tuesday and Friday |
| Price history backfill | 5 am daily |
| Database backup | 4 am daily |
| Notification prune | 4:30 am daily |

See [Architecture](/architecture/) for the full schedule table and per-task budgets.

## Data persistence

The database is a single SQLite file at `./data/hoard.db` inside the container (set by `DATABASE_URL`, default `./data/hoard.db`). The production Compose file mounts this to a named Docker volume (`hoard_data`). Do not skip the volume or bind mount — if you run the container without one, the database lives inside the container layer and will be lost on rebuild.

Make sure the data directory is writable by the UID the container runs as. On systems where you can't easily match UIDs (e.g. Synology DSM without passwordless sudo), the simplest fix is `chmod 777 ./data` so any container user can write to it.

Backups write to `./backups` on the host by default (configurable via `BACKUP_PATH`). The same permission rule applies — if the container user can't write there, the nightly backup task will log a failure. See [Backups](/self-hosting/backups/) for backup and restore instructions.

## Common first-run issues

**Steam library is empty after sync.** Check that `STEAM_USER_ID` is the correct Steam64 ID (a 17-digit number starting with `7656`). Verify at [steamid.io](https://steamid.io). Also confirm your Steam profile and game details are both set to Public — even a "Friends only" visibility will block API access.

**"Steam profile is private" error or 0 games returned.** Go to your Steam profile → Edit Profile → Privacy Settings. Set "Game details" to Public, not just your profile.

**API key errors on startup.** If you set keys in `.env.production` but the container isn't picking them up, confirm you passed `--env-file .env.production` to `docker-compose`. The file is not loaded by default.

**`NEXT_PUBLIC_APP_URL` not reflected in the running app.** This variable is baked in at build time. Changing it in `.env.production` and restarting the container has no effect — you need to rebuild: `docker-compose -f docker-compose.prod.yml --env-file .env.production build`.

**`/setup` redirects to `/login` immediately.** A user already exists in the database. Log in with your existing credentials. If you need to reset auth, clear the `user`, `session`, `account`, and `verification` tables and restart.
