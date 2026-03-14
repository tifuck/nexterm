#!/usr/bin/env bash
# ============================================================================
# Nexterm — Uninstall Script
# ============================================================================
# Stops and removes the systemd service, and optionally removes data files
# and the installation directory.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colours & helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'
BOLD='\033[1m'

info() { echo -e "  ${DIM}$*${NC}"; }
ok()   { echo -e "  ${GREEN}$*${NC}"; }
warn() { echo -e "  ${YELLOW}$*${NC}"; }

SERVICE_NAME="nexterm"

# ── Banner ───────────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo '  ╔══════════════════════════════════════════════╗'
echo '  ║           Nexterm Uninstaller                ║'
echo '  ╚══════════════════════════════════════════════╝'
echo -e "${NC}"

echo -e "${YELLOW}This will remove Nexterm from your system.${NC}"
echo ""
read -rp "$(echo -e "${BOLD}Are you sure? (y/N):${NC} ")" CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi
echo ""

# ── Stop and remove systemd service ─────────────────────────────────────────

echo -e "${BOLD}Removing systemd service...${NC}"

if command -v systemctl &>/dev/null; then
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        if [ "$(id -u)" -eq 0 ]; then
            systemctl stop "$SERVICE_NAME" 2>/dev/null || true
            systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        else
            sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
            sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        fi
        ok "Service stopped and disabled"
    else
        info "Service not running"
    fi

    SVC_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    if [ -f "$SVC_FILE" ]; then
        if [ "$(id -u)" -eq 0 ]; then
            rm -f "$SVC_FILE"
            systemctl daemon-reload
        else
            sudo rm -f "$SVC_FILE"
            sudo systemctl daemon-reload
        fi
        ok "Service file removed"
    else
        info "No service file found at $SVC_FILE"
    fi
else
    info "systemd not available, skipping"
fi

# ── Remove guacd container ──────────────────────────────────────────────────

if command -v docker &>/dev/null; then
    if docker ps -a --format '{{.Names}}' | grep -q "nexterm-guacd"; then
        echo ""
        echo -e "${BOLD}Removing guacd Docker container...${NC}"
        docker stop nexterm-guacd 2>/dev/null || true
        docker rm nexterm-guacd 2>/dev/null || true
        ok "guacd container removed"
    fi
fi

# ── Remove local service file ───────────────────────────────────────────────

rm -f "$SCRIPT_DIR/${SERVICE_NAME}.service" 2>/dev/null || true

# ── Remove data ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Remove application data?${NC}"
echo -e "  This includes the database, SSL certificates, and config."
read -rp "$(echo -e "  ${YELLOW}Remove data? (y/N):${NC} ")" REMOVE_DATA

if [[ "$REMOVE_DATA" =~ ^[Yy]$ ]]; then
    rm -rf "$SCRIPT_DIR/data" 2>/dev/null || true
    rm -rf "$SCRIPT_DIR/certs" 2>/dev/null || true
    rm -f  "$SCRIPT_DIR/config.yaml" 2>/dev/null || true
    rm -f  "$SCRIPT_DIR/install.log" 2>/dev/null || true
    rm -f  "$SCRIPT_DIR/update.log" 2>/dev/null || true
    ok "Data removed"
else
    info "Data preserved at: $SCRIPT_DIR/data/"
fi

# ── Remove venv and node_modules ────────────────────────────────────────────

echo ""
echo -e "${BOLD}Remove build artifacts (venv, node_modules, frontend/dist)?${NC}"
read -rp "$(echo -e "  ${YELLOW}Remove build artifacts? (Y/n):${NC} ")" REMOVE_BUILD

if [[ ! "$REMOVE_BUILD" =~ ^[Nn]$ ]]; then
    rm -rf "$SCRIPT_DIR/venv" 2>/dev/null || true
    rm -rf "$SCRIPT_DIR/frontend/node_modules" 2>/dev/null || true
    rm -rf "$SCRIPT_DIR/frontend/dist" 2>/dev/null || true
    rm -f  "$SCRIPT_DIR/frontend/tsconfig.tsbuildinfo" 2>/dev/null || true
    ok "Build artifacts removed"
else
    info "Build artifacts preserved"
fi

# ── Remove installation directory ────────────────────────────────────────────

echo ""
echo -e "${BOLD}Remove the entire installation directory?${NC}"
echo -e "  ${DIM}${SCRIPT_DIR}${NC}"
read -rp "$(echo -e "  ${RED}Remove everything? (y/N):${NC} ")" REMOVE_ALL

if [[ "$REMOVE_ALL" =~ ^[Yy]$ ]]; then
    echo ""
    ok "Removing $SCRIPT_DIR ..."
    cd /
    rm -rf "$SCRIPT_DIR"
    echo -e "${GREEN}${BOLD}  Nexterm has been completely removed.${NC}"
else
    echo ""
    echo -e "${GREEN}${BOLD}  Nexterm has been uninstalled.${NC}"
    info "Source code remains at: $SCRIPT_DIR"
fi

echo ""
