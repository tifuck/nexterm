#!/usr/bin/env bash
# ============================================================================
# Nexterm — Update Script
# ============================================================================
# Pulls latest code, updates dependencies, rebuilds frontend, runs database
# migrations, and restarts the service if it's running.
#
# Usage:  bash update.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/update.log"
: > "$LOG_FILE"

# ── Colours & helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'
BOLD='\033[1m'

STEP=0
TOTAL_STEPS=5

_log()  { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG_FILE"; }
_die()  { echo -e "${RED}[ERROR] $*${NC}" >&2; echo "       See update.log for details."; exit 1; }

step() {
    STEP=$((STEP + 1))
    echo -e "${BOLD}[${STEP}/${TOTAL_STEPS}]${NC} $1"
    _log "STEP $STEP: $1"
}

ok()   { echo -e "      ${GREEN}done${NC}"; }
warn() { echo -e "      ${YELLOW}$*${NC}"; }
info() { echo -e "      ${DIM}$*${NC}"; }

run_quiet() {
    if "$@" >> "$LOG_FILE" 2>&1; then
        return 0
    else
        local rc=$?
        echo -e "      ${RED}Command failed: $*${NC}"
        echo -e "      ${DIM}Last 20 lines of update.log:${NC}"
        tail -20 "$LOG_FILE" | sed 's/^/      /'
        return $rc
    fi
}

SERVICE_NAME="nexterm"

# ── Banner ───────────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo '  ╔══════════════════════════════════════════════╗'
echo '  ║            Nexterm Updater                   ║'
echo '  ╚══════════════════════════════════════════════╝'
echo -e "${NC}"

# ── Step 1: Pull latest code ────────────────────────────────────────────────

step "Pulling latest changes..."

if [ -d ".git" ]; then
    # Stash any local changes to tracked files
    if ! git diff --quiet 2>/dev/null; then
        warn "Stashing local changes..."
        run_quiet git stash || warn "git stash failed (continuing anyway)"
    fi

    GIT_OUTPUT=$(git pull 2>&1) || _die "git pull failed: $GIT_OUTPUT"
    echo "$GIT_OUTPUT" >> "$LOG_FILE"

    if echo "$GIT_OUTPUT" | grep -q "Already up to date"; then
        info "Already up to date"
    else
        info "Updated to latest version"
    fi
else
    warn "Not a git repository — skipping git pull"
    info "To enable updates, clone with: git clone <repo-url>"
fi
ok

# ── Step 2: Update Python dependencies ──────────────────────────────────────

step "Updating Python dependencies..."

if [ ! -d "venv" ]; then
    _die "Virtual environment not found. Run install.sh first."
fi

# shellcheck disable=SC1091
source venv/bin/activate
run_quiet pip install --upgrade pip || warn "pip upgrade failed"
run_quiet pip install -r requirements.txt || _die "Failed to install Python dependencies"
ok

# ── Step 3: Rebuild frontend ────────────────────────────────────────────────

step "Rebuilding frontend..."

(
    cd frontend
    run_quiet npm install || _die "Failed to install Node dependencies"
    run_quiet npx vite build || _die "Frontend build failed"
)
ok

# ── Step 4: Update database schema ──────────────────────────────────────────

step "Updating database schema..."

run_quiet python3 -c "
import asyncio, sys; sys.path.insert(0, '.')
from backend.database import init_db
asyncio.run(init_db())
" || _die "Failed to update database schema"
ok

# ── Step 5: Restart service ─────────────────────────────────────────────────

step "Restarting service..."

SERVICE_RUNNING=false

if command -v systemctl &>/dev/null; then
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        SERVICE_RUNNING=true
    fi
fi

if $SERVICE_RUNNING; then
    if [ "$(id -u)" -eq 0 ]; then
        systemctl restart "$SERVICE_NAME" >> "$LOG_FILE" 2>&1
    else
        sudo systemctl restart "$SERVICE_NAME" >> "$LOG_FILE" 2>&1
    fi
    info "Service restarted"
else
    info "Service not running — start manually with: ./venv/bin/python run.py"
fi
ok

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}  Update complete!${NC}"
echo ""
