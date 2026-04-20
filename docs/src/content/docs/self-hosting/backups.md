---
title: Backup and restore
description: SQLite .backup runbook for Hoard — manual, scheduled, and restore operations.
---

Hoard uses SQLite's built-in `.backup` API rather than a plain file copy. The difference matters: `cp` on a live database can catch it mid-write, and in WAL mode the main file alone is incomplete — the `-wal` and `-shm` sidecar files hold uncommitted data. `.backup` does an atomic, page-level copy that works correctly regardless of WAL state. The resulting backup file is a fully self-contained, valid SQLite database.

## Backup via script (manual)

Run `./scripts/backup.sh` from the project root. An optional first argument sets the output directory.

```bash
# Default: writes to ./data/backups/
./scripts/backup.sh

# Write to a Synology shared folder
./scripts/backup.sh /volume1/backups/hoard
```

Backup files are named `hoard_YYYYMMDD_HHMMSS.db`.

After creating the file, the script runs `PRAGMA integrity_check` against the backup. If the check returns anything other than `ok`, the script exits with an error. A failed integrity check is a real problem — investigate before relying on that file.

Retention defaults to 30 days. The script deletes files matching `hoard_*.db` older than that threshold from the backup directory. Override per-run with the `BACKUP_RETENTION_DAYS` environment variable:

```bash
BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh
```

If `sqlite3` is not in `PATH`, the script falls back to `cp` with explicit WAL/SHM copies. This is less safe; install the `sqlite3` CLI on the host if you can.

## Backup via in-app scheduler (automated)

The scheduler registers a `database-backup` task at startup via `src/instrumentation.ts`. It runs on the `CRON_BACKUP` schedule, defaulting to `0 4 * * *` (4am daily).

The in-app task uses `better-sqlite3`'s `.backup()` API directly — no shell dependency required. It writes to a `backups/` subdirectory alongside the database file. In production, `DATABASE_URL` is `/app/data/hoard.db`, so backups land at `/app/data/backups/`.

That container path is bind-mounted from the host via `docker-compose.prod.yml`:

```yaml
volumes:
  - ${BACKUP_PATH:-./backups}:/app/data/backups
```

If `BACKUP_PATH` is unset, backups appear in `./backups/` next to your compose file on the host. Set `BACKUP_PATH` in `.env.production` to redirect them to a named share or external volume.

The in-app task also runs `PRAGMA integrity_check` after each backup and sends a Discord ops alert on failure (if `DISCORD_OPS_WEBHOOK_URL` is configured).

**Path difference to be aware of:** the shell script defaults to `./data/backups/` (relative to the project root), while the in-app task writes to `/app/data/backups/` inside the container, mounted from `./backups/` on the host. They are separate locations. If you're running both, point the shell script at the same host path as `BACKUP_PATH` to consolidate.

## Restore from backup

Run `./scripts/restore.sh` with no arguments to list available backups in `./data/backups/`:

```bash
./scripts/restore.sh
```

Restore from a specific file:

```bash
./scripts/restore.sh data/backups/hoard_20260206_040000.db
```

Before replacing the live database, the script runs `PRAGMA integrity_check` on the backup file and aborts if it fails. It then creates a safety backup of the current database at `<db-path>.pre-restore.<timestamp>` using `cp`. This is your rollback point if the restore goes wrong — don't delete it until you've confirmed the restored DB is healthy.

The script prompts `Continue with restore? (y/N)` interactively. It is not safe to run unattended in a pipe without modification.

After copying the backup file into place, the script removes any existing `-wal` and `-shm` sidecar files to force a clean state.

**Restart the container after restore.** The app holds a singleton database connection via `getDb()`. Swapping the file on disk while the process is running has no effect — the old connection is still live. Restart the Next.js container before doing anything else:

```bash
docker-compose -f docker-compose.prod.yml restart app
```

## Retention

The default retention period is 30 days, controlled by `BACKUP_RETENTION_DAYS`. Both the shell script and the in-app task respect this value.

Override it permanently via `.env.production`:

```
BACKUP_RETENTION_DAYS=14
```

Or per-run when calling the shell script directly:

```bash
BACKUP_RETENTION_DAYS=60 ./scripts/backup.sh /volume1/backups/hoard
```

Set `BACKUP_RETENTION_DAYS=0` to disable automatic cleanup entirely — files will accumulate until you remove them manually.

## External cron entry (NAS)

The in-app scheduler handles daily backups automatically. If you want a second independent layer — a backup of the backup — add an entry to the NAS cron that runs the shell script against the mounted host path:

```text
0 4 * * * cd /volume3/docker/hoard && ./scripts/backup.sh /volume1/backups/hoard
```

Stagger this from the in-app backup schedule if you're running both, so they don't contend on the database simultaneously.

## Before destructive operations

Always take a manual backup before running `npm run db:push`, pulling a new Docker image with schema changes, or running `restore.sh`. The in-app scheduler runs nightly, but a manual backup gives you a known-good snapshot from exactly before the operation.

For the full upgrade + migration flow, see [Upgrading](/self-hosting/upgrading/).
