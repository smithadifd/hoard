#!/usr/bin/env bash
set -euo pipefail

# ===========================================
# Hoard - Deploy to Synology NAS
# ===========================================
# Usage: ./scripts/deploy.sh
#
# Deploys the current main branch to the Synology NAS
# via SSH. Builds the Docker image on the NAS and
# restarts the container.
#
# Prerequisites:
#   - SSH key auth configured (ssh synology)
#   - .env.production on NAS at /volume3/docker/hoard/.env.production
#   - Git installed on NAS (via Synology package or entware)

# Configuration — override via environment or .deploy.env
if [ -f "$(dirname "$0")/../.deploy.env" ]; then
    # shellcheck disable=SC1091
    source "$(dirname "$0")/../.deploy.env"
fi
REMOTE="${DEPLOY_REMOTE:-synology}"
REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/volume3/docker/hoard}"
REMOTE_DOCKER_PATH="${DEPLOY_DOCKER_PATH:-export PATH=/usr/local/bin:/usr/syno/bin:\$PATH}"
REPO_URL="${DEPLOY_REPO_URL:-$(git remote get-url origin 2>/dev/null || echo 'git@github.com:user/hoard.git')}"
COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-docker-compose.prod.yml}"
APP_PORT="${DEPLOY_APP_PORT:-3001}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ------------------------------------------
# Pre-flight checks (local)
# ------------------------------------------
preflight() {
    info "Running pre-flight checks..."

    # Check we're on main
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$branch" != "main" ]]; then
        error "Not on main branch (currently on: $branch)"
        error "Switch to main and merge your changes first."
        exit 1
    fi

    # Check for uncommitted changes
    if ! git diff --quiet HEAD 2>/dev/null; then
        error "Uncommitted changes detected. Commit or stash first."
        exit 1
    fi

    # Check remote is up to date
    git fetch origin main --quiet
    local local_hash remote_hash
    local_hash=$(git rev-parse HEAD)
    remote_hash=$(git rev-parse origin/main)
    if [[ "$local_hash" != "$remote_hash" ]]; then
        warn "Local main differs from origin/main."
        warn "Local:  $local_hash"
        warn "Remote: $remote_hash"
        read -rp "Continue anyway? [y/N] " confirm
        [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
    fi

    info "Pre-flight checks passed. Deploying commit: ${local_hash:0:8}"
}

# ------------------------------------------
# Deploy to NAS
# ------------------------------------------
deploy() {
    local commit_hash
    commit_hash=$(git rev-parse --short HEAD)

    info "Connecting to NAS..."

    # Check if repo exists on NAS, clone or pull
    ssh "$REMOTE" bash -s <<REMOTE_SCRIPT
set -euo pipefail
$REMOTE_DOCKER_PATH

echo "--- Setting up project directory ---"
if [ ! -d "$REMOTE_PATH/.git" ]; then
    echo "Cloning repository..."
    mkdir -p "$REMOTE_PATH"
    git clone "$REPO_URL" "$REMOTE_PATH"
else
    echo "Pulling latest changes..."
    cd "$REMOTE_PATH"
    git fetch origin main
    git reset --hard origin/main
fi

cd "$REMOTE_PATH"
echo "Now at commit: \$(git rev-parse --short HEAD)"

# Check for .env.production
if [ ! -f ".env.production" ]; then
    echo ""
    echo "ERROR: .env.production not found at $REMOTE_PATH/.env.production"
    echo "Create it from .env.example and fill in production values:"
    echo "  ssh $REMOTE"
    echo "  cp $REMOTE_PATH/.env.example $REMOTE_PATH/.env.production"
    echo "  nano $REMOTE_PATH/.env.production"
    exit 1
fi

echo ""
echo "--- Creating pre-deploy backup ---"
# Hit the backup API endpoint on the running container
if curl -sf --max-time 30 -X POST "http://localhost:3001/api/backup" > /dev/null 2>&1; then
    echo "Pre-deploy backup created successfully"
else
    echo "WARNING: Pre-deploy backup failed (container may not be running)"
fi

echo ""
echo "--- Building Docker image ---"
docker-compose -f "$COMPOSE_FILE" --env-file .env.production build

# Ensure backup directory exists and is writable by container (UID 1001)
mkdir -p "${BACKUP_PATH:-./backups}"
chmod 777 "${BACKUP_PATH:-./backups}"

echo ""
echo "--- Starting containers ---"
docker-compose -f "$COMPOSE_FILE" --env-file .env.production up -d

echo ""
echo "--- Running database migrations ---"
# Run drizzle-kit push inside the container to apply any schema changes
# Uses the builder stage's node_modules which include drizzle-kit
docker exec hoard_app node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/hoard.db');
const fs = require('fs');

// Read current schema columns
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(t => t.name);
const columnsByTable = {};
for (const table of tables) {
  columnsByTable[table] = db.pragma('table_info(' + table + ')').map(c => c.name);
}

// Schema migrations — add new columns that don't exist yet
const migrations = [
  { table: 'games', column: 'is_released', sql: 'ALTER TABLE games ADD COLUMN is_released INTEGER' },
];

let applied = 0;
for (const m of migrations) {
  if (columnsByTable[m.table] && !columnsByTable[m.table].includes(m.column)) {
    db.exec(m.sql);
    console.log('  Applied: ' + m.sql);
    applied++;
  }
}
if (applied === 0) console.log('  Schema is up to date');
db.close();
"

echo ""
echo "--- Container status ---"
docker-compose -f "$COMPOSE_FILE" ps
REMOTE_SCRIPT

    info "Deploy complete."
}

# ------------------------------------------
# Health check
# ------------------------------------------
healthcheck() {
    info "Running health check..."

    # Get NAS IP from SSH config
    local nas_host
    nas_host=$(ssh -G "$REMOTE" | awk '/^hostname / {print $2}')

    local url="http://${nas_host}:${APP_PORT}"
    local max_attempts=10
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
            info "Health check passed: $url"

            # Verify app health endpoint
            info "Verifying app health..."
            local health_json
            health_json=$(curl -sf --max-time 10 "http://${nas_host}:${APP_PORT}/api/health" 2>/dev/null) || true
            if [ -n "$health_json" ]; then
                local app_status
                app_status=$(echo "$health_json" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['status'])" 2>/dev/null) || true
                if [ "$app_status" = "healthy" ]; then
                    info "App health: healthy (DB + scheduler OK)"
                elif [ -n "$app_status" ]; then
                    warn "App health: $app_status - check container logs"
                fi
            fi

            return 0
        fi
        warn "Attempt $attempt/$max_attempts - waiting for app to start..."
        sleep 3
        ((attempt++))
    done

    error "Health check failed after $max_attempts attempts."
    error "Check container logs: ssh $REMOTE 'cd $REMOTE_PATH && docker-compose -f $COMPOSE_FILE logs --tail 50'"
    return 1
}

# ------------------------------------------
# Main
# ------------------------------------------
main() {
    echo ""
    echo "========================================="
    echo "  Hoard - Deploy to Synology NAS"
    echo "========================================="
    echo ""

    preflight
    deploy
    healthcheck

    echo ""
    info "Deployment successful!"
    local nas_host
    nas_host=$(ssh -G "$REMOTE" | awk '/^hostname / {print $2}')
    info "App available at: http://${nas_host}:${APP_PORT}"
    echo ""
}

main "$@"
