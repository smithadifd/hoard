#!/bin/bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BACKUP_SCRIPT="$ROOT/scripts/backup.sh"
SCRATCH=$(mktemp -d)
BIN_DIR="$SCRATCH/bin"
mkdir -p "$BIN_DIR"
trap 'rm -r "$SCRATCH"' EXIT
NO_SQLITE_BIN="$SCRATCH/no-sqlite-bin"
NO_CHECKSUM_BIN="$SCRATCH/no-checksum-bin"
mkdir -p "$NO_SQLITE_BIN" "$NO_CHECKSUM_BIN"
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
assert_no_backup() {
  local backup_dir=$1
  local description=$2
  local files=("$backup_dir"/hoard_*.db)
  if [ "${#files[@]}" -ne 0 ]; then
    fail "$description should leave no .db backup, found ${#files[@]}"
  fi
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
      if [[ "$5" == *"database.backup"* ]]; then
        if [ "${STUB_RAW_COPY:-0}" = "1" ]; then
          /bin/cp "$STUB_FIXTURE_DB" "$STUB_CONTAINER_BACKUP"
        else
          DATABASE_URL="$STUB_FIXTURE_DB" node -e "$5" "$STUB_CONTAINER_BACKUP"
        fi
      elif [[ "$5" == *"integrity_check"* ]]; then
        if [ "${STUB_CONTAINER_VERIFIER_AVAILABLE:-1}" != "1" ]; then
          printf 'in-container SQLite verifier unavailable\n' >&2
          exit 127
        fi
        node -e "$5" "$STUB_CONTAINER_BACKUP"
      else
        printf 'Unexpected docker node program\n' >&2
        exit 2
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
    if [ "${STUB_ALTER_COPY:-0}" = "1" ]; then
      node -e '
const fs = require("fs");
const path = process.argv[1];
const descriptor = fs.openSync(path, "r+");
const position = fs.statSync(path).size - 1;
const byte = Buffer.alloc(1);
fs.readSync(descriptor, byte, 0, 1, position);
byte[0] ^= 0xff;
fs.writeSync(descriptor, byte, 0, 1, position);
fs.closeSync(descriptor);
' "$3"
    fi
    ;;
  *)
    printf 'Unexpected docker command: %s\n' "$*" >&2
    exit 2
    ;;
esac
DOCKER_STUB
chmod +x "$BIN_DIR/sqlite3" "$BIN_DIR/docker"
for tool in bash cut date du find mkdir node rm wc; do
  tool_path=$(command -v "$tool") || fail "required test tool is unavailable: $tool"
  ln -s "$tool_path" "$NO_SQLITE_BIN/$tool"
  ln -s "$tool_path" "$NO_CHECKSUM_BIN/$tool"
done
ln -s "$BIN_DIR/docker" "$NO_SQLITE_BIN/docker"
ln -s "$BIN_DIR/docker" "$NO_CHECKSUM_BIN/docker"
if command -v sha256sum > /dev/null 2>&1; then
  CHECKSUM_TOOL="sha256sum"
elif command -v shasum > /dev/null 2>&1; then
  CHECKSUM_TOOL="shasum"
else
  fail "sha256sum or shasum is required to exercise the checksum fallback"
fi
ln -s "$(command -v "$CHECKSUM_TOOL")" "$NO_SQLITE_BIN/$CHECKSUM_TOOL"

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

NO_SQLITE_VALID_BACKUPS="$SCRATCH/no-sqlite-valid-backups"
NO_SQLITE_VALID_OUTPUT="$SCRATCH/no-sqlite-valid-output.txt"
if ! PATH="$NO_SQLITE_BIN" \
  DATABASE_URL="$SCRATCH/no-sqlite-valid-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/no-sqlite-valid-docker.log" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/no-sqlite-valid-container-copy.db" \
  bash "$BACKUP_SCRIPT" "$NO_SQLITE_VALID_BACKUPS" > "$NO_SQLITE_VALID_OUTPUT" 2>&1; then
  fail "valid container database should succeed without host sqlite3"
fi
NO_SQLITE_VALID_BACKUP=$(single_backup "$NO_SQLITE_VALID_BACKUPS")
assert_backup "$NO_SQLITE_VALID_BACKUP"
NO_SQLITE_VALID_MESSAGE=$(<"$NO_SQLITE_VALID_OUTPUT")
[[ "$NO_SQLITE_VALID_MESSAGE" == *"Integrity check passed in the container; copied file matches its size and SHA-256 checksum"* ]] ||
  fail "no-host-sqlite3 success should report fallback verification; output: $NO_SQLITE_VALID_MESSAGE"
pass "container backup is verified without host sqlite3"

NO_SQLITE_CORRUPT_BACKUPS="$SCRATCH/no-sqlite-corrupt-backups"
NO_SQLITE_CORRUPT_OUTPUT="$SCRATCH/no-sqlite-corrupt-output.txt"
if PATH="$NO_SQLITE_BIN" \
  DATABASE_URL="$SCRATCH/no-sqlite-corrupt-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/no-sqlite-corrupt-docker.log" \
  STUB_FIXTURE_DB="$CORRUPT_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/no-sqlite-corrupt-container-copy.db" \
  STUB_RAW_COPY=1 \
  bash "$BACKUP_SCRIPT" "$NO_SQLITE_CORRUPT_BACKUPS" > "$NO_SQLITE_CORRUPT_OUTPUT" 2>&1; then
  fail "corrupt container database should fail in-container integrity validation without host sqlite3"
fi
assert_no_backup "$NO_SQLITE_CORRUPT_BACKUPS" "failed in-container integrity validation"
NO_SQLITE_CORRUPT_MESSAGE=$(<"$NO_SQLITE_CORRUPT_OUTPUT")
[[ "$NO_SQLITE_CORRUPT_MESSAGE" == *"Container backup verification failed:"* ]] ||
  fail "corrupt in-container backup should report verification failure; output: $NO_SQLITE_CORRUPT_MESSAGE"
pass "corrupt container backup fails closed without host sqlite3"

ALTERED_COPY_BACKUPS="$SCRATCH/altered-copy-backups"
ALTERED_COPY_OUTPUT="$SCRATCH/altered-copy-output.txt"
if PATH="$NO_SQLITE_BIN" \
  DATABASE_URL="$SCRATCH/altered-copy-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/altered-copy-docker.log" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/altered-copy-container.db" \
  STUB_ALTER_COPY=1 \
  bash "$BACKUP_SCRIPT" "$ALTERED_COPY_BACKUPS" > "$ALTERED_COPY_OUTPUT" 2>&1; then
  fail "copy-out mutation should fail byte-identity validation"
fi
assert_no_backup "$ALTERED_COPY_BACKUPS" "failed byte-identity validation"
ALTERED_COPY_MESSAGE=$(<"$ALTERED_COPY_OUTPUT")
[[ "$ALTERED_COPY_MESSAGE" == *"Copied container backup does not match the verified in-container file"* ]] ||
  fail "altered copy should report a byte-identity mismatch; output: $ALTERED_COPY_MESSAGE"
pass "copy-out mutation fails size and checksum validation"

NO_CONTAINER_VERIFIER_BACKUPS="$SCRATCH/no-container-verifier-backups"
NO_CONTAINER_VERIFIER_OUTPUT="$SCRATCH/no-container-verifier-output.txt"
if PATH="$NO_SQLITE_BIN" \
  DATABASE_URL="$SCRATCH/no-container-verifier-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=0 \
  DOCKER_LOG="$SCRATCH/no-container-verifier-docker.log" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/no-container-verifier-container.db" \
  STUB_CONTAINER_VERIFIER_AVAILABLE=0 \
  bash "$BACKUP_SCRIPT" "$NO_CONTAINER_VERIFIER_BACKUPS" > "$NO_CONTAINER_VERIFIER_OUTPUT" 2>&1; then
  fail "container backup should fail when its integrity verifier is unavailable"
fi
assert_no_backup "$NO_CONTAINER_VERIFIER_BACKUPS" "missing in-container verifier failure"
NO_CONTAINER_VERIFIER_MESSAGE=$(<"$NO_CONTAINER_VERIFIER_OUTPUT")
[[ "$NO_CONTAINER_VERIFIER_MESSAGE" == *"Container backup verification failed: in-container SQLite verifier unavailable"* ]] ||
  fail "missing in-container verifier should report a clear error; output: $NO_CONTAINER_VERIFIER_MESSAGE"
pass "container backup fails closed when its integrity verifier is unavailable"

NO_VERIFIER_BACKUPS="$SCRATCH/no-verifier-backups"
NO_VERIFIER_OUTPUT="$SCRATCH/no-verifier-output.txt"
mkdir -p "$NO_VERIFIER_BACKUPS"
printf 'retained backup\n' > "$NO_VERIFIER_BACKUPS/hoard_retained.db"
touch -t 202001010000 "$NO_VERIFIER_BACKUPS/hoard_retained.db"
if PATH="$NO_CHECKSUM_BIN" \
  DATABASE_URL="$SCRATCH/no-verifier-host.db" \
  HOARD_CONTAINER=hoard_app \
  BACKUP_RETENTION_DAYS=1 \
  DOCKER_LOG="$SCRATCH/no-verifier-docker.log" \
  STUB_FIXTURE_DB="$FIXTURE_DB" \
  STUB_CONTAINER_BACKUP="$SCRATCH/no-verifier-container.db" \
  bash "$BACKUP_SCRIPT" "$NO_VERIFIER_BACKUPS" > "$NO_VERIFIER_OUTPUT" 2>&1; then
  fail "container backup should fail when no complete verification path is available"
fi
[ -f "$NO_VERIFIER_BACKUPS/hoard_retained.db" ] ||
  fail "retention cleanup should not run after verification-path failure"
NO_VERIFIER_MESSAGE=$(<"$NO_VERIFIER_OUTPUT")
[[ "$NO_VERIFIER_MESSAGE" == *"Cannot verify container backup: sqlite3, sha256sum, and shasum are unavailable on the host"* ]] ||
  fail "missing verifier should report all unavailable host tools; output: $NO_VERIFIER_MESSAGE"
pass "container backup fails closed without a host byte-identity verifier"

pass "9 backup script cases"
