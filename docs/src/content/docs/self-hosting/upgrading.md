---
title: Upgrading
description: Schema migrations, dependency upgrades, and Synology redeploy for Hoard.
---

Hoard upgrades come in three flavors: app code (new features, bug fixes), schema changes (new tables or columns in `src/lib/db/schema.ts`), and dependency bumps. App-code upgrades are low risk — rebuild and restart. Schema changes need an extra step after deploy. Dependency bumps should go through CI before landing on the NAS.

## Before any upgrade

Take a backup first. The deploy script does this automatically (it hits `POST /api/backup` on the running container before rebuilding), but it can fail silently if the container is stopped. A manual backup takes ten seconds and means you have a safe restore point no matter what. See [Backups](/self-hosting/backups/) for the full backup and restore workflow.

## App-code upgrade (no schema change)

For a routine update — a new feature, a bug fix, anything that doesn't touch `schema.ts` — the canonical path is the deploy script:

```bash
./scripts/deploy.sh
```

Run this from your dev machine with the repo on `main` and no uncommitted changes. The script:

1. Checks you're on `main` and local matches `origin/main` (warns if not, asks to confirm)
2. SSHs into the NAS (`ssh synology`)
3. Pulls the latest commits from GitHub (`git reset --hard origin/main`)
4. Verifies `.env.production` exists at `/volume3/docker/hoard/.env.production`
5. Creates a pre-deploy backup via the running container
6. Runs `docker-compose -f docker-compose.prod.yml --env-file .env.production build`
7. Restarts with `docker-compose -f docker-compose.prod.yml --env-file .env.production up -d`
8. Polls `GET /api/health` until the container responds healthy

The Synology NAS runs Docker Compose v1 — the script already uses the hyphenated `docker-compose` CLI. Don't change it to `docker compose`.

If you need to override the remote, path, or compose file, create a `.deploy.env` file in the project root. The script sources it if present.

## Schema migration

Drizzle manages the schema. The source of truth is `src/lib/db/schema.ts`, and `drizzle-kit push` computes a diff and applies it to the database directly — no migration files needed for the common case.

**In development**, after editing `schema.ts`:

```bash
npm run db:push
```

This applies the changes to your local SQLite file at `./data/hoard.db` (or whatever `DATABASE_URL` points to).

**In production**, the flow is:

1. Take a backup (see above).
2. Deploy the new code with `./scripts/deploy.sh`. The container now has the updated `schema.ts` inside it.
3. Run `db:push` inside the running container:

   ```bash
   docker exec -it hoard_app npm run db:push
   ```

   The container name is `hoard_app` — set via `container_name` in `docker-compose.prod.yml`.

4. The command prints each change it applies. Additive changes (new columns, new tables) apply cleanly. If everything is up to date, it prints nothing and exits zero.

**Better Auth tables** are managed by the same Drizzle schema. A `db:push` after a Better Auth version bump will pick up any new columns it needs.

**Destructive changes** — dropped columns, renamed tables — are where `db:push` gets cautious. Drizzle will detect potential data loss and may refuse to apply automatically. For those cases, generate an explicit migration file instead:

```bash
npm run db:generate
```

This writes a SQL migration into `./drizzle/`. Review it, then apply it manually or via `npm run db:migrate`. The `./drizzle/` directory is committed, so the migration travels with the code.

For everyday additive schema work (adding a column, a new table), `db:push` is the right tool. Reach for `db:generate` only when Drizzle warns about data loss.

## Dependency upgrades

Dependabot opens PRs for npm dependency bumps weekly. The process:

1. Review the PR — check the changelog for breaking changes, especially for Next.js major versions, Drizzle major versions, or anything touching the auth stack.
2. CI runs on the PR: lint, type-check, unit tests, and a Docker build.
3. Merge when CI is green.
4. CI runs again on `main`. Once it passes, deploy: `./scripts/deploy.sh`.

For minor and patch bumps that CI accepts, this is quick. For major version upgrades (e.g., a Next.js major), test locally first with `npm run build` before merging.

## Docker image updates

Hoard doesn't use a pre-built registry image. The deploy script builds the image from source directly on the NAS using the `docker/Dockerfile` in the repo. There's nothing to `docker pull`. Getting the latest image means pulling the latest code and rebuilding, which is what `./scripts/deploy.sh` does.

If you ever switch to a registry-based workflow, this section is where that process would live.

## Rollback

**Code rollback**: Revert the offending commit on `main`, push, run `./scripts/deploy.sh`. The deploy script always builds from `origin/main`, so whatever is on `main` is what lands on the NAS.

```bash
git revert <commit-hash>
git push origin main
./scripts/deploy.sh
```

**Schema rollback**: `db:push` with an older schema can reverse additive changes (dropping a column it previously added). Reliable rollback for destructive schema changes requires the backup — restore from it. See [Backups](/self-hosting/backups/). This is why the pre-deploy backup matters.

## Post-upgrade checks

Once the deploy script reports success and the health check passes, confirm the app is healthy:

- **Health endpoint** — `GET /api/health` returns `{ "status": "healthy" }` when the database is reachable, the scheduler has registered tasks, and no sync rows are stuck. The deploy script checks this automatically; you can also hit it directly: `http://your-nas:3001/api/health`.
- **Steam sync** — Go to Settings → Sync and trigger a manual library sync. If it completes without error, the database, Steam API key, and scheduler are all working.
- **Cron tasks** — The sync log on the Settings page shows the last run time for each task. Confirm the timestamps are recent and no tasks show a failed status.
- **Discord webhook** — If you use deal or ops alerts, go to Settings and use the "Test webhook" button to confirm the webhook URL is still valid and the container can reach Discord.
