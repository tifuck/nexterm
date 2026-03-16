#!/bin/bash
# ============================================================================
# Nexterm — Docker Entrypoint
# ============================================================================
# Ensures config.yaml exists (copies from example if needed), generates SSL
# certs, initialises the database, and creates the admin user from env vars.
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

# ── Create admin user from env vars ─────────────────────────────────────────
# NEXTERM_ADMIN_USER and NEXTERM_ADMIN_PASSWORD are checked by run.py on
# startup, but we also handle it here so the user gets clear log output.

if [ -n "$NEXTERM_ADMIN_USER" ] && [ -n "$NEXTERM_ADMIN_PASSWORD" ]; then
    echo "[entrypoint] Checking admin user..."
    python3 -c "
import asyncio, os, sys, bcrypt
sys.path.insert(0, '.')
from backend.database import async_session_factory
from backend.models.user import User
from sqlalchemy import select, func

async def ensure_admin():
    async with async_session_factory() as session:
        count = await session.scalar(
            select(func.count()).select_from(User).where(User.is_admin == True)
        )
        if count and count > 0:
            print('[entrypoint] Admin user already exists')
            return
        pw_hash = bcrypt.hashpw(
            os.environ['NEXTERM_ADMIN_PASSWORD'].encode(),
            bcrypt.gensalt()
        ).decode()
        user = User(
            username=os.environ['NEXTERM_ADMIN_USER'],
            password_hash=pw_hash,
            is_admin=True,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        print(f'[entrypoint] Admin user \"{os.environ[\"NEXTERM_ADMIN_USER\"]}\" created')

asyncio.run(ensure_admin())
" || echo "[entrypoint] WARNING: Could not create admin user"
fi

echo "[entrypoint] Starting Nexterm..."
exec "$@"
