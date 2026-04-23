---
title: Self-hosting guide
description: Prerequisites, Docker Compose setup, first-run steps, and port configuration.
---

Clone the repo, fill in a handful of environment variables, run one command, and Hoard is running. The steps below cover everything from zero to your Steam library showing up in the UI.

## Prerequisites

You need:

- **Docker** with Docker Compose (v2 plugin: `docker compose`; or Compose v1 CLI: `docker-compose` — both work)
- **A Steam Web API key** — generate one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
- **Your Steam64 ID** — look it up at [steamid.io](https://steamid.io) if you don't know it
- **A public Steam profile** — Hoard reads your library and wishlist via the Steam Web API, which requires your profile and game details visibility to be set to Public. If they're private, the sync will return empty results or an error.
- **Port 3001 free** on the host (the production Compose file binds `3001:3000`)

Optional but worth having:

- **An IsThereAnyDeal API key** — register at [isthereanydeal.com/dev/app](https://isthereanydeal.com/dev/app/). Without this, price history and deal tracking are unavailable.
- **A Discord webhook URL** — for price alert and watchlist notifications. Create one under Server Settings → Integrations → Webhooks. A second webhook (`DISCORD_OPS_WEBHOOK_URL`) can receive operational alerts (sync failures, health summaries) separately from deal alerts; if omitted it falls back to the main webhook.

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

   Production:

   ```bash
   docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```

   On older Synology NAS or systems with Compose v1:

   ```bash
   export PATH=/usr/local/bin:/usr/syno/bin:$PATH
   docker-compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```

   The image is built locally during this step. First build takes a few minutes.

5. **Create your admin account.** Open `http://your-host:3001` in a browser. On first run, with no users in the database yet, Hoard redirects to `/setup` where you create the admin credentials. Once the account exists, any further visit to `/setup` redirects to `/login` instead.

6. **Trigger the initial Steam sync.** Go to Settings → Sync and kick off the library sync and wishlist sync manually. The cron schedules handle subsequent runs automatically.

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

## First sync

After account setup, run these from Settings → Sync in order:

1. **Steam library sync** — imports owned games with playtime data
2. **Steam wishlist sync** — imports wishlisted games
3. **ITAD price sync** — fetches current prices and historical lows across stores (requires `ITAD_API_KEY`)

HLTB (game duration data) and review enrichment run on their own cron schedules — HLTB runs twice a week, reviews twice a week. Both can be triggered manually from Settings if you want data immediately. See [Architecture](/architecture/) for the full schedule table.

Cron defaults if you don't override them:

| Task | Default schedule |
|---|---|
| Library sync | 3 am daily |
| Wishlist sync | 1 am daily |
| Price check | Every 12 hours |
| HLTB sync | 2 am Sunday and Wednesday |
| Review enrichment | 4 am Tuesday and Friday |
| Database backup | 4 am daily |

## Data persistence

The database is a single SQLite file at `./data/hoard.db` inside the container (set by `DATABASE_URL`, default `./data/hoard.db`). The production Compose file mounts this to a named Docker volume (`hoard_data`). Do not skip the volume or bind mount — if you run the container without one, the database lives inside the container layer and will be lost on rebuild.

On a NAS or any system where you don't have passwordless sudo, the data directory needs to be world-writable:

```bash
chmod 777 ./data
```

Backups write to `./backups` on the host by default (configurable via `BACKUP_PATH`). The same `chmod 777` applies if the container user can't write there. See [Backups](/self-hosting/backups/) for backup and restore instructions.

## Common first-run issues

**Steam library is empty after sync.** Check that `STEAM_USER_ID` is the correct Steam64 ID (a 17-digit number starting with `7656`). Verify at [steamid.io](https://steamid.io). Also confirm your Steam profile and game details are both set to Public — even a "Friends only" visibility will block API access.

**"Steam profile is private" error or 0 games returned.** Go to your Steam profile → Edit Profile → Privacy Settings. Set "Game details" to Public, not just your profile.

**API key errors on startup.** If you set keys in `.env.production` but the container isn't picking them up, confirm you passed `--env-file .env.production` to `docker-compose`. The file is not loaded by default.

**`NEXT_PUBLIC_APP_URL` not reflected in the running app.** This variable is baked in at build time. Changing it in `.env.production` and restarting the container has no effect — you need to rebuild: `docker-compose -f docker-compose.prod.yml --env-file .env.production build`.

**`/setup` redirects to `/login` immediately.** A user already exists in the database. Log in with your existing credentials. If you need to reset auth, clear the `user`, `session`, `account`, and `verification` tables and restart.
