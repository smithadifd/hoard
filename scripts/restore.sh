#!/bin/bash
# ===========================================
# Hoard - SQLite Database Restore Script
# ===========================================
#
# Restores a backup to the active database location.
# Creates a safety backup of the current DB before restoring.
#
# Usage:
#   ./scripts/restore.sh                              # List available backups
#   ./scripts/restore.sh data/backups/hoard_20260206.db  # Restore specific backup

set -euo pipefail

DB_PATH="${DATABASE_URL:-./data/hoard.db}"
BACKUP_DIR="./data/backups"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[RESTORE]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[RESTORE]${NC} $1"; }
log_error() { echo -e "${RED}[RESTORE]${NC} $1"; }

# No argument = list available backups
if [ $# -eq 0 ]; then
  echo ""
  log_info "Available backups:"
  echo ""
  if [ -d "$BACKUP_DIR" ]; then
    ls -lh "$BACKUP_DIR"/hoard_*.db 2>/dev/null | awk '{print "  " $NF " (" $5 ", " $6 " " $7 " " $8 ")"}'
    echo ""
    TOTAL=$(find "$BACKUP_DIR" -name "hoard_*.db" | wc -l)
    log_info "$TOTAL backup(s) found"
  else
    log_warn "No backup directory found at $BACKUP_DIR"
  fi
  echo ""
  echo "Usage: $0 <path-to-backup.db>"
  exit 0
fi

RESTORE_FILE="$1"

# Verify backup file exists
if [ ! -f "$RESTORE_FILE" ]; then
  log_error "Backup file not found: $RESTORE_FILE"
  exit 1
fi

# Integrity check on the backup before restoring
if command -v sqlite3 &> /dev/null; then
  INTEGRITY=$(sqlite3 "$RESTORE_FILE" "PRAGMA integrity_check;" 2>&1)
  if [ "$INTEGRITY" != "ok" ]; then
    log_error "Backup integrity check FAILED: $INTEGRITY"
    log_error "Aborting restore."
    exit 1
  fi
  log_info "Backup integrity verified"
fi

# Safety backup of current database
if [ -f "$DB_PATH" ]; then
  SAFETY_BACKUP="${DB_PATH}.pre-restore.$(date +%Y%m%d_%H%M%S)"
  cp "$DB_PATH" "$SAFETY_BACKUP"
  log_info "Safety backup of current DB: $SAFETY_BACKUP"
fi

# Stop the app if possible (inform user)
log_warn "Make sure Hoard is stopped before restoring!"
echo ""
read -p "Continue with restore? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  log_info "Restore cancelled."
  exit 0
fi

# Perform restore
cp "$RESTORE_FILE" "$DB_PATH"
# Remove WAL/SHM files to force clean state
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

log_info "Database restored from: $RESTORE_FILE"
log_info "Restart Hoard to use the restored database."
