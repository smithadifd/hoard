#!/bin/bash
# ===========================================
# Hoard - SQLite Database Backup Script
# ===========================================
#
# Uses SQLite's built-in .backup command for safe, consistent
# backups even while the app is running (WAL mode compatible).
#
# Usage:
#   ./scripts/backup.sh                    # Backup to default location
#   ./scripts/backup.sh /path/to/backups   # Backup to custom directory
#   BACKUP_RETENTION_DAYS=14 ./scripts/backup.sh  # Custom retention
#   HOARD_CONTAINER=hoard_app ./scripts/backup.sh # Container DB fallback
#
# If DATABASE_URL is not a host file, the script backs up the database in
# HOARD_CONTAINER (default: hoard_app) and copies the result to the host.
#
# Designed for cron scheduling:
#   0 4 * * * cd /path/to/hoard && ./scripts/backup.sh
#
# For Synology NAS, point to a shared folder:
#   ./scripts/backup.sh /volume1/backups/hoard

set -euo pipefail

# Configuration
DB_PATH="${DATABASE_URL:-./data/hoard.db}"
HOARD_CONTAINER="${HOARD_CONTAINER:-hoard_app}"
BACKUP_DIR="${1:-./data/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/hoard_${TIMESTAMP}.db"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[BACKUP]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[BACKUP]${NC} $1"; }
log_error() { echo -e "${RED}[BACKUP]${NC} $1"; }

# Select the host database when present, otherwise use the running app container.
SOURCE_MODE="host"
if [ ! -f "$DB_PATH" ]; then
  SOURCE_MODE="container"
  if ! command -v docker > /dev/null 2>&1 ||
     [ "$(docker inspect --format '{{.State.Running}}' "$HOARD_CONTAINER" 2>/dev/null)" != "true" ]; then
    log_error "Database not found at: $DB_PATH; container not reachable: $HOARD_CONTAINER"
    exit 1
  fi
fi

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

if [ "$SOURCE_MODE" = "host" ]; then
  # Get database size for logging
  DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
  log_info "Starting backup of $DB_PATH ($DB_SIZE)"

  # Use SQLite's .backup command for a safe, atomic backup
  # This works correctly even with WAL mode and concurrent readers
  if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
  else
    # Fallback: copy the file (less safe but works without sqlite3 CLI)
    log_warn "sqlite3 not found, falling back to file copy"
    cp "$DB_PATH" "$BACKUP_FILE"
    # Also copy WAL and SHM files if they exist
    [ -f "${DB_PATH}-wal" ] && cp "${DB_PATH}-wal" "${BACKUP_FILE}-wal"
    [ -f "${DB_PATH}-shm" ] && cp "${DB_PATH}-shm" "${BACKUP_FILE}-shm"
  fi
else
  CONTAINER_BACKUP_FILE="/tmp/hoard_backup_${TIMESTAMP}_$$.db"
  HOST_CHECKSUM_TOOL=""
  if ! command -v sqlite3 > /dev/null 2>&1; then
    if command -v sha256sum > /dev/null 2>&1; then
      HOST_CHECKSUM_TOOL="sha256sum"
    elif command -v shasum > /dev/null 2>&1; then
      HOST_CHECKSUM_TOOL="shasum"
    else
      log_error "Cannot verify container backup: sqlite3, sha256sum, and shasum are unavailable on the host"
      exit 1
    fi
  fi

  log_info "Starting backup of the database in container $HOARD_CONTAINER"

  if ! docker exec "$HOARD_CONTAINER" node -e '
const Database = require("better-sqlite3");
const source = process.env.DATABASE_URL || "/app/data/hoard.db";
const database = new Database(source, { readonly: true, fileMustExist: true });
(async () => {
  try {
    await database.backup(process.argv[1]);
  } finally {
    database.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
' "$CONTAINER_BACKUP_FILE"; then
    docker exec "$HOARD_CONTAINER" rm -f "$CONTAINER_BACKUP_FILE" > /dev/null 2>&1 || true
    log_error "Container database backup failed: $HOARD_CONTAINER"
    exit 1
  fi
  CONTAINER_SIZE=""
  CONTAINER_SHA256=""
  if [ -n "$HOST_CHECKSUM_TOOL" ]; then
    if ! CONTAINER_METADATA=$(docker exec "$HOARD_CONTAINER" node -e '
const crypto = require("crypto");
const fs = require("fs");
const Database = require("better-sqlite3");
const backupFile = process.argv[1];

(async () => {
  const database = new Database(backupFile, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`Integrity check failed: ${integrity}`);
    }
  } finally {
    database.close();
  }

  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(backupFile);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  process.stdout.write(`${fs.statSync(backupFile).size} ${hash.digest("hex")}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
' "$CONTAINER_BACKUP_FILE" 2>&1); then
      docker exec "$HOARD_CONTAINER" rm -f "$CONTAINER_BACKUP_FILE" > /dev/null 2>&1 || true
      log_error "Container backup verification failed: $CONTAINER_METADATA"
      exit 1
    fi

    if [[ "$CONTAINER_METADATA" =~ ^([0-9]+)\ ([0-9a-f]{64})$ ]]; then
      CONTAINER_SIZE="${BASH_REMATCH[1]}"
      CONTAINER_SHA256="${BASH_REMATCH[2]}"
    else
      docker exec "$HOARD_CONTAINER" rm -f "$CONTAINER_BACKUP_FILE" > /dev/null 2>&1 || true
      log_error "Container backup verification returned invalid metadata: $CONTAINER_METADATA"
      exit 1
    fi
  fi

  if ! docker cp "$HOARD_CONTAINER:$CONTAINER_BACKUP_FILE" "$BACKUP_FILE"; then
    docker exec "$HOARD_CONTAINER" rm -f "$CONTAINER_BACKUP_FILE" > /dev/null 2>&1 || true
    rm -f "$BACKUP_FILE"
    log_error "Could not copy container backup to: $BACKUP_FILE"
    exit 1
  fi
  docker exec "$HOARD_CONTAINER" rm -f "$CONTAINER_BACKUP_FILE" > /dev/null 2>&1 || true

  if [ -n "$HOST_CHECKSUM_TOOL" ]; then
    if ! HOST_SIZE=$(wc -c < "$BACKUP_FILE"); then
      rm -f "$BACKUP_FILE"
      log_error "Could not determine copied container backup size: $BACKUP_FILE"
      exit 1
    fi
    HOST_SIZE="${HOST_SIZE//[[:space:]]/}"
    if [ "$HOST_CHECKSUM_TOOL" = "sha256sum" ]; then
      if ! HOST_CHECKSUM_OUTPUT=$(sha256sum "$BACKUP_FILE"); then
        rm -f "$BACKUP_FILE"
        log_error "Could not checksum copied container backup: $BACKUP_FILE"
        exit 1
      fi
    else
      if ! HOST_CHECKSUM_OUTPUT=$(shasum -a 256 "$BACKUP_FILE"); then
        rm -f "$BACKUP_FILE"
        log_error "Could not checksum copied container backup: $BACKUP_FILE"
        exit 1
      fi
    fi
    HOST_SHA256="${HOST_CHECKSUM_OUTPUT%% *}"
    if [ "$HOST_SIZE" != "$CONTAINER_SIZE" ] || [ "$HOST_SHA256" != "$CONTAINER_SHA256" ]; then
      rm -f "$BACKUP_FILE"
      log_error "Copied container backup does not match the verified in-container file"
      exit 1
    fi
  fi
fi

# Verify backup was created
if [ ! -f "$BACKUP_FILE" ]; then
  log_error "Backup file was not created!"
  exit 1
fi

# Integrity check on the backup
if command -v sqlite3 &> /dev/null; then
  if ! INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1); then
    if [ "$SOURCE_MODE" = "container" ]; then
      rm -f "$BACKUP_FILE"
    fi
    log_error "Integrity check FAILED: $INTEGRITY"
    exit 1
  fi
  if [ "$INTEGRITY" = "ok" ]; then
    log_info "Integrity check passed"
  else
    if [ "$SOURCE_MODE" = "container" ]; then
      rm -f "$BACKUP_FILE"
    fi
    log_error "Integrity check FAILED: $INTEGRITY"
    exit 1
  fi
elif [ "$SOURCE_MODE" = "container" ]; then
  log_info "Integrity check passed in the container; copied file matches its size and SHA-256 checksum"
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log_info "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Clean up old backups (keep last N days)
if [ "$RETENTION_DAYS" -gt 0 ]; then
  OLD_COUNT=$(find "$BACKUP_DIR" -name "hoard_*.db" -mtime +"$RETENTION_DAYS" 2>/dev/null | wc -l)
  if [ "$OLD_COUNT" -gt 0 ]; then
    find "$BACKUP_DIR" -name "hoard_*.db" -mtime +"$RETENTION_DAYS" -delete
    find "$BACKUP_DIR" -name "hoard_*.db-wal" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
    find "$BACKUP_DIR" -name "hoard_*.db-shm" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
    log_info "Cleaned up $OLD_COUNT backup(s) older than $RETENTION_DAYS days"
  fi
fi

# Summary
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "hoard_*.db" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log_info "Done. $TOTAL_BACKUPS backup(s) in $BACKUP_DIR ($TOTAL_SIZE total)"
