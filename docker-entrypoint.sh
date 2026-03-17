#!/bin/bash
# ============================================================================
# Nexterm — Docker Entrypoint
# ============================================================================
# Ensures config.yaml exists (copies from example if needed), generates SSL
# certs, and initialises the database.
# ============================================================================

set -e

# ── Ensure config.yaml exists ───────────────────────────────────────────────
# The Python config loader handles this automatically, but we trigger it early
# so any errors are visible before the server starts.

if [ ! -f config.yaml ]; then
    echo "[entrypoint] Creating config.yaml from template..."
    cp config.example.yaml config.yaml
    # Replace placeholder secret key
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    sed -i "s/CHANGE_ME_TO_A_RANDOM_SECRET_KEY/$SECRET/" config.yaml
fi

# ── Initialise database ────────────────────────────────────────────────────

echo "[entrypoint] Initialising database..."
python3 -c "
import asyncio, sys
sys.path.insert(0, '.')
import backend.models          # register all models with Base.metadata
from backend.database import init_db
asyncio.run(init_db())
" || { echo "[entrypoint] ERROR: Database initialisation failed"; exit 1; }

# ── Generate SSL certificate if needed ──────────────────────────────────────

if [ ! -f certs/server.crt ] || [ ! -f certs/server.key ]; then
    echo "[entrypoint] Generating self-signed SSL certificate..."
    python3 -c "
import sys; sys.path.insert(0, '.')
from backend.utils.cert import generate_self_signed_cert
generate_self_signed_cert('certs/server.crt', 'certs/server.key')
" || echo "[entrypoint] WARNING: SSL certificate generation failed (continuing without HTTPS)"
fi

echo "[entrypoint] Starting Nexterm..."
exec "$@"
