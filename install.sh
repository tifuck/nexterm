#!/usr/bin/env bash
# ============================================================================
# Nexterm — One-Command Install Script
# ============================================================================
# Installs Python venv, Node dependencies, builds frontend, generates SSL
# certs, initialises the database, and optionally sets up a systemd service.
#
# All verbose output is written to install.log.  The user sees a clean
# step-by-step progress summary.  On error the relevant log section is shown.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/install.log"
: > "$LOG_FILE"  # truncate

# ── Colours & helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'
BOLD='\033[1m'

STEP=0
TOTAL_STEPS=6  # updated dynamically if guacd / service steps are added

_log()  { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG_FILE"; }
_die()  { echo -e "${RED}[ERROR] $*${NC}" >&2; echo "       See install.log for details."; exit 1; }

step() {
    STEP=$((STEP + 1))
    echo -e "${BOLD}[${STEP}/${TOTAL_STEPS}]${NC} $1"
    _log "STEP $STEP: $1"
}

ok()   { echo -e "      ${GREEN}done${NC}"; }
warn() { echo -e "      ${YELLOW}$*${NC}"; }
info() { echo -e "      ${DIM}$*${NC}"; }

# Run a command silently; on failure show last 20 lines of log.
run_quiet() {
    if "$@" >> "$LOG_FILE" 2>&1; then
        return 0
    else
        local rc=$?
        echo -e "      ${RED}Command failed: $*${NC}"
        echo -e "      ${DIM}Last 20 lines of install.log:${NC}"
        tail -20 "$LOG_FILE" | sed 's/^/      /'
        return $rc
    fi
}

# ── Platform detection ───────────────────────────────────────────────────────

detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then echo "apt"
    elif command -v dnf &>/dev/null; then echo "dnf"
    elif command -v yum &>/dev/null; then echo "yum"
    elif command -v pacman &>/dev/null; then echo "pacman"
    elif command -v brew &>/dev/null; then echo "brew"
    else echo "unknown"; fi
}

install_hint() {
    local pkg="$1"
    case "$(detect_pkg_manager)" in
        apt)    echo "sudo apt install $pkg" ;;
        dnf)    echo "sudo dnf install $pkg" ;;
        yum)    echo "sudo yum install $pkg" ;;
        pacman) echo "sudo pacman -S $pkg" ;;
        brew)   echo "brew install $pkg" ;;
        *)      echo "(install $pkg using your system package manager)" ;;
    esac
}

IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
    IS_WSL=true
fi

HAS_SYSTEMD=false
if command -v systemctl &>/dev/null && systemctl --version &>/dev/null 2>&1; then
    HAS_SYSTEMD=true
fi

# ── Banner ───────────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo '  ╔══════════════════════════════════════════════╗'
echo '  ║            Nexterm Installer                 ║'
echo '  ║      Web-Based Remote Access Client          ║'
echo '  ╚══════════════════════════════════════════════╝'
echo -e "${NC}"

if $IS_WSL; then
    echo -e "  ${DIM}Detected: WSL (Windows Subsystem for Linux)${NC}"
    echo ""
fi

# ── Check prerequisites ─────────────────────────────────────────────────────

echo -e "${BOLD}Checking prerequisites...${NC}"

missing=()

# Python 3.10+
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=${PY_VER%%.*}
    PY_MINOR=${PY_VER##*.}
    if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
        _die "Python 3.10+ is required (found $PY_VER)"
    fi
    echo -e "  ${GREEN}Python $PY_VER${NC}"
else
    missing+=("python3")
fi

# pip
if ! python3 -m pip --version &>/dev/null 2>&1 && ! command -v pip3 &>/dev/null; then
    missing+=("python3-pip")
fi

# python3-venv (Debian/Ubuntu ship python3 without venv)
if ! python3 -m venv --help &>/dev/null 2>&1; then
    PKG_MGR="$(detect_pkg_manager)"
    if [ "$PKG_MGR" = "apt" ]; then
        echo -e "  ${YELLOW}python3-venv is not installed.${NC}"
        read -rp "  Install it now? (Y/n): " INSTALL_VENV
        if [[ ! "$INSTALL_VENV" =~ ^[Nn]$ ]]; then
            sudo apt-get install -y "python${PY_VER}-venv" >> "$LOG_FILE" 2>&1 \
                || sudo apt-get install -y python3-venv >> "$LOG_FILE" 2>&1 \
                || _die "Failed to install python3-venv"
            echo -e "  ${GREEN}python3-venv installed${NC}"
        else
            _die "python3-venv is required. Install with: sudo apt install python3-venv"
        fi
    else
        _die "Python venv module is not available. $(install_hint python3-venv)"
    fi
fi

# Node.js 18+
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -lt 18 ]; then
        _die "Node.js 18+ is required (found $(node -v))"
    fi
    echo -e "  ${GREEN}Node.js $(node -v)${NC}"
else
    missing+=("nodejs")
fi

# npm
if ! command -v npm &>/dev/null; then
    missing+=("npm")
fi

if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}Missing required packages: ${missing[*]}${NC}"
    for pkg in "${missing[@]}"; do
        echo -e "  $(install_hint "$pkg")"
    done
    exit 1
fi

echo ""

# ── Configuration prompts ────────────────────────────────────────────────────

SKIP_CONFIG=false
if [ -f config.yaml ]; then
    echo -e "${YELLOW}config.yaml already exists. Overwrite? (y/N)${NC}"
    read -r OVERWRITE
    if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
        info "Keeping existing config.yaml"
        SKIP_CONFIG=true
    fi
fi

if [ "$SKIP_CONFIG" != "true" ]; then
    echo -e "${BOLD}Setup Configuration${NC}"
    echo ""

    # App name
    read -rp "$(echo -e "  ${CYAN}Application name${NC} [TERMINAL]: ")" APP_NAME
    APP_NAME="${APP_NAME:-TERMINAL}"

    # Server port
    read -rp "$(echo -e "  ${CYAN}Server port${NC} [8443]: ")" SERVER_PORT
    SERVER_PORT="${SERVER_PORT:-8443}"

    # Registration
    read -rp "$(echo -e "  ${CYAN}Enable user registration?${NC} (Y/n): ")" ENABLE_REG
    if [[ "$ENABLE_REG" =~ ^[Nn]$ ]]; then
        REG_ENABLED="false"
    else
        REG_ENABLED="true"
    fi

    # RDP support
    read -rp "$(echo -e "  ${CYAN}Enable RDP support (requires Docker for guacd)?${NC} (y/N): ")" ENABLE_RDP
    if [[ "$ENABLE_RDP" =~ ^[Yy]$ ]]; then
        GUACD_ENABLED="true"
        TOTAL_STEPS=$((TOTAL_STEPS + 1))
    else
        GUACD_ENABLED="false"
    fi

    # Generate secret key
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

    echo ""
fi

# Count service step
if $HAS_SYSTEMD && ! $IS_WSL; then
    TOTAL_STEPS=$((TOTAL_STEPS + 1))
fi

# ── Step 1: Write config ────────────────────────────────────────────────────

if [ "$SKIP_CONFIG" != "true" ]; then
    step "Writing configuration..."

    cat > config.yaml << EOF
# Nexterm Configuration — Generated by install.sh
app:
  name: "${APP_NAME}"
  host: "0.0.0.0"
  port: ${SERVER_PORT}
  debug: false
  secret_key: "${SECRET_KEY}"

auth:
  registration_enabled: ${REG_ENABLED}
  jwt_access_token_expire_minutes: 60
  jwt_refresh_token_expire_days: 7
  max_login_attempts: 5
  lockout_duration_minutes: 15

database:
  url: "sqlite+aiosqlite:///data/nexterm.db"

https:
  enabled: true
  cert_file: "certs/server.crt"
  key_file: "certs/server.key"
  auto_generate_cert: true

encryption:
  kdf_iterations: 600000

sessions:
  max_active_per_user: 20
  keep_alive_minutes: 30
  ssh_keepalive_interval: 60

guacd:
  enabled: ${GUACD_ENABLED}
  host: "localhost"
  port: 4822

ai:
  enabled: true

metrics:
  enabled: true
  interval_seconds: 5

deployment:
  mode: "local"
  allowed_origins: ["*"]
  trusted_proxies: []
EOF

    ok
else
    step "Using existing configuration..."
    ok
fi

# ── Step 2: Python virtual environment ───────────────────────────────────────

step "Setting up Python environment..."

if [ ! -d "venv" ]; then
    run_quiet python3 -m venv venv || _die "Failed to create virtual environment"
    info "Virtual environment created"
fi

# Activate
# shellcheck disable=SC1091
source venv/bin/activate

run_quiet pip install --upgrade pip || _die "Failed to upgrade pip"
run_quiet pip install -r requirements.txt || _die "Failed to install Python dependencies"
ok

# ── Step 3: Frontend build ───────────────────────────────────────────────────

step "Building frontend..."

(
    cd frontend
    run_quiet npm install || _die "Failed to install Node dependencies"
    info "Dependencies installed, building..."
    run_quiet npx vite build || _die "Frontend build failed"
)
ok

# ── Step 4: SSL certificate ─────────────────────────────────────────────────

step "Setting up SSL certificate..."

mkdir -p certs
if [ ! -f "certs/server.crt" ] || [ ! -f "certs/server.key" ]; then
    run_quiet python3 -c "
import sys; sys.path.insert(0, '.')
from backend.utils.cert import generate_self_signed_cert
generate_self_signed_cert('certs/server.crt', 'certs/server.key')
" || _die "Failed to generate SSL certificate"
    info "Self-signed certificate generated"
else
    info "Certificate already exists, skipping"
fi
ok

# ── Step 5: Database ────────────────────────────────────────────────────────

step "Initialising database..."

mkdir -p data
run_quiet python3 -c "
import asyncio, sys; sys.path.insert(0, '.')
from backend.database import init_db
asyncio.run(init_db())
" || _die "Failed to initialise database"
ok

# ── Step 6 (optional): guacd ─────────────────────────────────────────────────

if [ "${GUACD_ENABLED:-false}" = "true" ]; then
    step "Setting up guacd for RDP support..."
    if command -v docker &>/dev/null; then
        if ! docker ps -a --format '{{.Names}}' | grep -q "nexterm-guacd"; then
            run_quiet docker run -d --name nexterm-guacd --restart unless-stopped \
                -p 4822:4822 guacamole/guacd \
                || warn "Failed to start guacd container (Docker issue?)"
            info "guacd container started"
        else
            docker start nexterm-guacd >> "$LOG_FILE" 2>&1 || true
            info "guacd container already exists"
        fi
    else
        warn "Docker not found — install Docker to enable RDP support"
    fi
    ok
fi

# ── Step 7 (optional): Systemd service ──────────────────────────────────────

SERVICE_NAME="nexterm"

if $HAS_SYSTEMD && ! $IS_WSL; then
    step "Setting up systemd service..."

    cat > "${SERVICE_NAME}.service" << EOF
[Unit]
Description=${APP_NAME:-Nexterm} - Web Remote Access Client
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${SCRIPT_DIR}
Environment=PATH=${SCRIPT_DIR}/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${SCRIPT_DIR}/venv/bin/python ${SCRIPT_DIR}/run.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    info "Service file created: ${SERVICE_NAME}.service"

    read -rp "$(echo -e "  ${CYAN}Install and start the service now?${NC} (Y/n): ")" INSTALL_SVC
    if [[ ! "$INSTALL_SVC" =~ ^[Nn]$ ]]; then
        if [ "$(id -u)" -eq 0 ]; then
            cp "${SERVICE_NAME}.service" /etc/systemd/system/
            systemctl daemon-reload
            systemctl enable --now "$SERVICE_NAME" >> "$LOG_FILE" 2>&1
            info "Service installed and started"
        else
            sudo cp "${SERVICE_NAME}.service" /etc/systemd/system/ \
                && sudo systemctl daemon-reload \
                && sudo systemctl enable --now "$SERVICE_NAME" >> "$LOG_FILE" 2>&1 \
                && info "Service installed and started" \
                || warn "Could not install service (try with sudo)"
        fi
    else
        info "Skipped.  To install manually:"
        info "  sudo cp ${SERVICE_NAME}.service /etc/systemd/system/"
        info "  sudo systemctl daemon-reload"
        info "  sudo systemctl enable --now ${SERVICE_NAME}"
    fi
    ok
fi

# ── Done ─────────────────────────────────────────────────────────────────────

PORT="${SERVER_PORT:-8443}"

echo ""
echo -e "${GREEN}${BOLD}"
echo '  ╔══════════════════════════════════════════════╗'
echo '  ║          Installation Complete!              ║'
echo '  ╠══════════════════════════════════════════════╣'
echo '  ║                                              ║'
echo '  ║  Start the server:                           ║'
echo '  ║    ./venv/bin/python run.py                  ║'
echo '  ║                                              ║'
if $HAS_SYSTEMD && ! $IS_WSL; then
echo "  ║  Or as a service:                            ║"
echo "  ║    sudo systemctl start ${SERVICE_NAME}$(printf '%*s' $((18 - ${#SERVICE_NAME})) '')║"
echo '  ║                                              ║'
fi
printf '  ║  Access at: %-33s║\n' "https://localhost:${PORT}"
echo '  ║                                              ║'
echo '  ║  Update:    bash update.sh                   ║'
echo '  ║  Uninstall: bash uninstall.sh                ║'
echo '  ║                                              ║'
echo '  ╚══════════════════════════════════════════════╝'
echo -e "${NC}"
