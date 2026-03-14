#!/usr/bin/env python3
"""Server entry point."""
import asyncio
import atexit
import logging
import os
import signal
import sys
import time
import multiprocessing

# Add project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.config import config
from backend.services.ipc_protocol import IPC_SOCKET_PATH

logger = logging.getLogger("nexterm.run")


async def _ensure_admin_user():
    """Create the admin user from environment variables if no admin exists.

    Checks NEXTERM_ADMIN_USER and NEXTERM_ADMIN_PASSWORD.  This enables
    zero-config Docker deployments where the admin account is set via
    ``docker-compose.yml`` environment variables.
    """
    admin_user = os.environ.get("NEXTERM_ADMIN_USER", "").strip()
    admin_pass = os.environ.get("NEXTERM_ADMIN_PASSWORD", "").strip()

    if not admin_user or not admin_pass:
        return

    import bcrypt
    from sqlalchemy import select, func
    from backend.database import async_session_factory
    from backend.models.user import User

    async with async_session_factory() as session:
        # Only create if no admin user exists at all
        count = await session.scalar(
            select(func.count()).select_from(User).where(User.is_admin == True)  # noqa: E712
        )
        if count and count > 0:
            return

        pw_hash = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt()).decode()
        user = User(
            username=admin_user,
            password_hash=pw_hash,
            is_admin=True,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        logger.info("Admin user '%s' created from environment variables", admin_user)


def main():
    import uvicorn

    # ------------------------------------------------------------------
    # Start the dedicated SSH manager process before uvicorn.
    # This process owns all SSH connections, SFTP clients, and session
    # state.  Uvicorn workers communicate with it over a Unix socket.
    # ------------------------------------------------------------------
    from backend.services.ssh_process import run_ssh_process

    ssh_proc = multiprocessing.Process(
        target=run_ssh_process,
        name="nexterm-ssh-manager",
        daemon=True,
    )
    ssh_proc.start()

    # Wait for the Unix socket to become available.
    for _ in range(60):  # Up to 30 seconds
        if os.path.exists(IPC_SOCKET_PATH):
            break
        time.sleep(0.5)
    else:
        print("[ERROR] SSH manager process did not start in time")
        ssh_proc.terminate()
        sys.exit(1)

    # ------------------------------------------------------------------
    # Auto-create admin user from env vars (Docker / CI support).
    # ------------------------------------------------------------------
    try:
        asyncio.run(_ensure_admin_user())
    except Exception as exc:
        logger.warning("Could not auto-create admin user: %s", exc)

    def _cleanup():
        """Terminate the SSH manager process on exit."""
        if ssh_proc.is_alive():
            ssh_proc.terminate()
            ssh_proc.join(timeout=5)
            if ssh_proc.is_alive():
                ssh_proc.kill()

    atexit.register(_cleanup)

    # Also handle SIGTERM/SIGINT so the SSH process is cleaned up
    # even when uvicorn is killed directly.
    original_sigterm = signal.getsignal(signal.SIGTERM)
    original_sigint = signal.getsignal(signal.SIGINT)

    def _signal_handler(signum, frame):
        _cleanup()
        # Re-raise to let uvicorn handle its own shutdown.
        if signum == signal.SIGTERM and callable(original_sigterm):
            original_sigterm(signum, frame)
        elif signum == signal.SIGINT and callable(original_sigint):
            original_sigint(signum, frame)
        else:
            sys.exit(0)

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    # ------------------------------------------------------------------
    # Launch uvicorn
    # ------------------------------------------------------------------
    ssl_kwargs = {}
    if config.https_enabled:
        cert_file = config.cert_file
        key_file = config.key_file
        if os.path.exists(cert_file) and os.path.exists(key_file):
            ssl_kwargs = {
                "ssl_certfile": cert_file,
                "ssl_keyfile": key_file,
            }
        else:
            print(f"[WARN] SSL cert/key not found at {cert_file}, {key_file}")
            print("[WARN] Run install.sh or set auto_generate_cert: true in config.yaml")
    
    print(f"""
    ╔══════════════════════════════════════════════╗
    ║  {config.app_name:^42}  ║
    ║                                              ║
    ║  {'https' if ssl_kwargs else 'http'}://{config.host}:{config.port:<26}  ║
    ╚══════════════════════════════════════════════╝
    """)
    
    uvicorn.run(
        "backend.main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        workers=1 if config.debug else 4,
        log_level="debug" if config.debug else "info",
        **ssl_kwargs,
    )


if __name__ == "__main__":
    main()
