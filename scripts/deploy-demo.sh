#!/usr/bin/env bash
set -euo pipefail

# ===========================================
# Hoard - Deploy to EC2 Demo
# ===========================================
# Usage: ./scripts/deploy-demo.sh
#
# Deploys the current main branch to the EC2 demo server.
# Requires SSH alias 'demo' configured in ~/.ssh/config.

REMOTE="demo"
REMOTE_PATH="/opt/demos/hoard"
REPO_URL="https://github.com/smithadifd/hoard.git"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

info "Deploying Hoard demo to EC2..."

ssh "$REMOTE" bash -s <<REMOTE_SCRIPT
set -euo pipefail

echo "--- Setting up project directory ---"
if [ ! -d "$REMOTE_PATH/.git" ]; then
    echo "Cloning repository..."
    sudo mkdir -p "$REMOTE_PATH"
    sudo chown ubuntu:ubuntu "$REMOTE_PATH"
    git clone "$REPO_URL" "$REMOTE_PATH"
else
    echo "Pulling latest changes..."
    cd "$REMOTE_PATH"
    git fetch origin main
    git reset --hard origin/main
fi

cd "$REMOTE_PATH"
echo "Now at commit: \$(git rev-parse --short HEAD)"

# Check for .env.demo
if [ ! -f ".env.demo" ]; then
    echo ""
    echo "ERROR: .env.demo not found at $REMOTE_PATH/.env.demo"
    echo "Create it with: echo 'BETTER_AUTH_SECRET=<secret>' > $REMOTE_PATH/.env.demo"
    exit 1
fi

echo ""
echo "--- Building Docker image ---"
docker compose -f docker-compose.demo.yml --env-file .env.demo build

echo ""
echo "--- Starting containers ---"
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d

echo ""
echo "--- Container status ---"
docker compose -f docker-compose.demo.yml ps
REMOTE_SCRIPT

info "Waiting for health check..."
sleep 5

# Health check via SSH (Caddy handles external TLS, we check internal)
if ssh "$REMOTE" "curl -sf --max-time 10 http://localhost:3011/api/health > /dev/null 2>&1"; then
    info "Health check passed!"
else
    warn "Health check failed — check container logs on EC2"
fi

info "Deploy complete. Demo at https://hoard.smithadifd.com"
