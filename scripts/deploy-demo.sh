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
INFRA_DIR="${DEMO_INFRA_DIR:-$HOME/demo-infra}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Ensure SSH access (auto-update security group if IP changed) ---
ensure_ssh_access() {
    if [ ! -f "$INFRA_DIR/terraform.tfvars" ]; then
        warn "demo-infra not found at $INFRA_DIR — skipping IP check"
        return 0
    fi

    local current_ip tfvars_ip
    current_ip=$(curl -s --max-time 5 ifconfig.me)
    tfvars_ip=$(grep 'admin_ip' "$INFRA_DIR/terraform.tfvars" | sed 's/.*"\(.*\)".*/\1/')

    if [[ "$current_ip" != "$tfvars_ip" ]]; then
        warn "Admin IP changed ($tfvars_ip -> $current_ip). Updating security group..."
        (cd "$INFRA_DIR" && ./update-ip.sh)
        info "Security group updated."
    else
        info "Admin IP unchanged ($current_ip)."
    fi
}

info "Deploying Hoard demo to EC2..."

ensure_ssh_access

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
echo "--- Stopping all containers to free memory for build ---"
docker stop \$(docker ps -q) 2>/dev/null || true

echo ""
echo "--- Building Docker image ---"
docker compose -f docker-compose.demo.yml --env-file .env.demo build

echo ""
echo "--- Starting containers ---"
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d

echo ""
echo "--- Restarting other demo services ---"
for dir in /opt/demos/*/; do
    [ "\$dir" = "$REMOTE_PATH/" ] && continue
    if [ -f "\$dir/docker-compose.demo.yml" ] && [ -f "\$dir/.env.demo" ]; then
        echo "Restarting \$(basename \$dir)..."
        (cd "\$dir" && docker compose -f docker-compose.demo.yml --env-file .env.demo up -d) || true
    fi
done

echo ""
echo "--- Container status ---"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
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
