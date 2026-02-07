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
#
# Designed for cron scheduling:
#   0 4 * * * cd /path/to/hoard && ./scripts/backup.sh
#
# For Synology NAS, point to a shared folder:
#   ./scripts/backup.sh /volume1/backups/hoard

set -euo pipefail

# Configuration
DB_PATH="${DATABASE_URL:-./data/hoard.db}"
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

# Verify source database exists
if [ ! -f "$DB_PATH" ]; then
  log_error "Database not found at: $DB_PATH"
  exit 1
fi

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

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

# Verify backup was created
if [ ! -f "$BACKUP_FILE" ]; then
  log_error "Backup file was not created!"
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log_info "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# Integrity check on the backup
if command -v sqlite3 &> /dev/null; then
  INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)
  if [ "$INTEGRITY" = "ok" ]; then
    log_info "Integrity check passed"
  else
    log_error "Integrity check FAILED: $INTEGRITY"
    exit 1
  fi
fi

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
