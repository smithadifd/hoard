#!/bin/bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BACKUP_SCRIPT="$ROOT/scripts/backup.sh"
SCRATCH=$(mktemp -d)
BIN_DIR="$SCRATCH/bin"
mkdir -p "$BIN_DIR"
trap 'rm -r "$SCRATCH"' EXIT
shopt -s nullglob

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

create_fixture() {
  node -e '
const Database = require("better-sqlite3");
const database = new Database(process.argv[1]);
database.exec("CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
const insert = database.prepare("INSERT INTO games (title) VALUES (?)");
for (const title of ["Alpha", "Bravo", "Charlie"]) insert.run(title);
database.close();
' "$1"
}

single_backup() {
  local backup_dir=$1
  local files=("$backup_dir"/hoard_*.db)
  if [ "${#files[@]}" -ne 1 ]; then
    fail "expected one backup in $backup_dir, found ${#files[@]}"
  fi
  printf '%s\n' "${files[0]}"
}

assert_backup() {
  local backup_file=$1
  local integrity
  local row_count
  integrity=$(node -e '
const Database = require("better-sqlite3");
const database = new Database(process.argv[1], { readonly: true, fileMustExist: true });
process.stdout.write(String(database.pragma("integrity_check", { simple: true })));
database.close();
' "$backup_file")
  [ "$integrity" = "ok" ] || fail "backup integrity should be ok, got: $integrity"

  row_count=$(node -e '
const Database = require("better-sqlite3");
const database = new Database(process.argv[1], { readonly: true, fileMustExist: true });
process.stdout.write(String(database.prepare("SELECT COUNT(*) FROM games").pluck().get()));
database.close();
' "$backup_file")
  [ "$row_count" = "3" ] || fail "backup row count should be 3, got: $row_count"
}

cat > "$BIN_DIR/sqlite3" <<'SQLITE_STUB'
#!/bin/bash
set -euo pipefail

source_file=$1
statement=$2
if [[ "$statement" == ".backup "* ]]; then
  destination=${statement#".backup '"}
  destination=${destination%"'"}
  node -e '
const Database = require("better-sqlite3");
const source = new Database(process.argv[1], { readonly: true, fileMustExist: true });
source.backup(process.argv[2])
  .then(() => source.close())
  .catch((error) => {
    source.close();
    console.error(error.message);
    process.exit(1);
  });
' "$source_file" "$destination"
else
  node -e '
const Database = require("better-sqlite3");
let result;
try {
  const database = new Database(process.argv[1], { readonly: true, fileMustExist: true });
  result = database.pragma("integrity_check", { simple: true });
  database.close();
} catch (error) {
  result = error.message;
}
process.stdout.write(String(result));
' "$source_file"
fi
SQLITE_STUB

cat > "$BIN_DIR/docker" <<'DOCKER_STUB'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  inspect)
    if [ "${STUB_CONTAINER_AVAILABLE:-1}" = "1" ]; then
      printf 'true\n'
    else
      exit 1
    fi
    ;;
  exec)
    if [ "$3" = "node" ] && [ "$4" = "-e" ]; then
      if [ "${STUB_RAW_COPY:-0}" = "1" ]; then
        /bin/cp "$STUB_FIXTURE_DB" "$STUB_CONTAINER_BACKUP"
      else
        DATABASE_URL="$STUB_FIXTURE_DB" node -e "$5" "$STUB_CONTAINER_BACKUP"
      fi
    elif [ "$3" = "rm" ]; then
      /bin/rm -f "$STUB_CONTAINER_BACKUP"
    else
      printf 'Unexpected docker exec command: %s\n' "$*" >&2
      exit 2
    fi
    ;;
  cp)
    /bin/cp "$STUB_CONTAINER_BACKUP" "$3"
    ;;
  *)
    printf 'Unexpected docker command: %s\n' "$*" >&2
    exit 2
    ;;
esac
DOCKER_STUB
chmod +x "$BIN_DIR/sqlite3" "$BIN_DIR/docker"

cd "$ROOT"
FIXTURE_DB="$SCRATCH/container-fixture.db"
create_fixture "$FIXTURE_DB"

CONTAINER_BACKUPS="$SCRATCH/container-backups"
CONTAINER_LOG="$SCRATCH/container-docker.log"
CONTAINER_OUTPUT="$SCRATCH/container-output.txt"
if ! PATH="$BIN_DIR:$PATH" \
  DATABASE_URL="$SCRATCH/no-host-database.db" \
  HOARD_CONTAINER='' \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$CONTAINER_LOG" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/container-copy.db" \
  bash "$BACKUP_SCRIPT" "$CONTAINER_BACKUPS" > "$CONTAINER_OUTPUT" 2>&1; then
  fail "container database case should succeed"
fi
CONTAINER_BACKUP=$(single_backup "$CONTAINER_BACKUPS")
assert_backup "$CONTAINER_BACKUP"
CONTAINER_CALLS=$(<"$CONTAINER_LOG")
[[ "$CONTAINER_CALLS" == *"inspect --format {{.State.Running}} hoard_app"* ]] ||
  fail "docker stub was not invoked with default container hoard_app"
pass "container-only database is backed up with the default container name"

HOST_BACKUPS="$SCRATCH/host-backups"
HOST_LOG="$SCRATCH/host-docker.log"
HOST_OUTPUT="$SCRATCH/host-output.txt"
: > "$HOST_LOG"
if ! PATH="$BIN_DIR:$PATH" \
  DATABASE_URL="$FIXTURE_DB" \
  HOARD_CONTAINER=unused_container \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$HOST_LOG" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/unused-container-copy.db" \
  bash "$BACKUP_SCRIPT" "$HOST_BACKUPS" > "$HOST_OUTPUT" 2>&1; then
  fail "host database case should succeed"
fi
HOST_BACKUP=$(single_backup "$HOST_BACKUPS")
assert_backup "$HOST_BACKUP"
[ ! -s "$HOST_LOG" ] || fail "host database path should not invoke docker"
pass "host database path is backed up without Docker"

MISSING_OUTPUT="$SCRATCH/missing-output.txt"
if PATH="$BIN_DIR:$PATH" \
  DATABASE_URL="$SCRATCH/missing-host.db" \
  HOARD_CONTAINER=missing_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/missing-docker.log" \
  STUB_CONTAINER_AVAILABLE=0 \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/missing-container-copy.db" \
  bash "$BACKUP_SCRIPT" "$SCRATCH/missing-backups" > "$MISSING_OUTPUT" 2>&1; then
  fail "missing host and container case should fail"
fi
MISSING_MESSAGE=$(<"$MISSING_OUTPUT")
[[ "$MISSING_MESSAGE" == *"Database not found at: $SCRATCH/missing-host.db; container not reachable: missing_app"* ]] ||
  fail "missing-source error should name the host path and container; output: $MISSING_MESSAGE"
pass "missing host database and container produce a clear error"

CORRUPT_DB="$SCRATCH/corrupt-container.db"
printf 'not a sqlite database\n' > "$CORRUPT_DB"
CORRUPT_OUTPUT="$SCRATCH/corrupt-output.txt"
if PATH="$BIN_DIR:$PATH" \
  DATABASE_URL="$SCRATCH/no-corrupt-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/corrupt-docker.log" \
  STUB_FIXTURE_DB="$CORRUPT_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/corrupt-container-copy.db" \
  STUB_RAW_COPY=1 \
  bash "$BACKUP_SCRIPT" "$SCRATCH/corrupt-backups" > "$CORRUPT_OUTPUT" 2>&1; then
  fail "corrupt container database should fail integrity validation"
fi
CORRUPT_MESSAGE=$(<"$CORRUPT_OUTPUT")
[[ "$CORRUPT_MESSAGE" == *"Integrity check FAILED:"* ]] ||
  fail "corrupt container database should report integrity failure; output: $CORRUPT_MESSAGE"
pass "corrupt copied database fails host integrity validation"

pass "4 backup script cases"
