"""Dedicated SSH manager process.

Runs as a standalone asyncio process that owns all SSH connections,
SFTP clients, and active session state.  Uvicorn workers communicate
with this process over a Unix domain socket using length-prefixed JSON.
"""

import asyncio
import base64
import json
import logging
import os
import signal
import sys
from pathlib import Path

# Ensure project root is on sys.path so ``backend.*`` imports work when
# this module is launched as ``python -m backend.services.ssh_process``.
_PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from backend.config import config
from backend.services.ipc_protocol import IPC_SOCKET_PATH, encode_message, read_message
from backend.services.session_manager import session_manager
from backend.services.sftp_service import sftp_manager
from backend.services.ssh_service import (
    ssh_manager,
    AuthenticationFailed,
    HostKeyVerificationRequired,
)

logging.basicConfig(
    level=logging.DEBUG if config.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("nexterm.ssh_process")


# ---------------------------------------------------------------------------
# Subscriber management — maps connection_id to a set of asyncio writers
# that should receive live SSH output.
# ---------------------------------------------------------------------------

_subscribers: dict[str, set[asyncio.StreamWriter]] = {}


def _add_subscriber(connection_id: str, writer: asyncio.StreamWriter) -> None:
    if connection_id not in _subscribers:
        _subscribers[connection_id] = set()
    _subscribers[connection_id].add(writer)


def _remove_subscriber(connection_id: str, writer: asyncio.StreamWriter) -> None:
    subs = _subscribers.get(connection_id)
    if subs:
        subs.discard(writer)
        if not subs:
            del _subscribers[connection_id]


def _make_ipc_callback(connection_id: str):
    """Create a ws_callback that broadcasts SSH output to all IPC subscribers.

    When ``data`` is ``None`` the SSH session has ended.  A special
    ``"disconnected"`` IPC message is broadcast so worker-side proxies
    can notify the frontend immediately.
    """

    async def _broadcast(data: bytes | None) -> None:
        subs = _subscribers.get(connection_id)
        if not subs:
            logger.debug(
                "Broadcast: conn=%s — no subscribers, dropping",
                connection_id[:8],
            )
            return

        if len(subs) > 1 and data is not None:
            logger.debug(
                "Broadcast: conn=%s ipc_subscribers=%d bytes=%d",
                connection_id[:8], len(subs), len(data),
            )

        # Sentinel: SSH session ended — broadcast a disconnect notification
        # instead of a data stream message.
        if data is None:
            reason = "SSH session ended"
            conn = await ssh_manager.get_connection(connection_id)
            if conn and conn.disconnected_reason:
                reason = conn.disconnected_reason
            msg = encode_message({
                "id": None,
                "method": "disconnected",
                "params": {
                    "connection_id": connection_id,
                    "reason": reason,
                },
            })
        else:
            msg = encode_message({
                "id": None,
                "method": "stream",
                "params": {
                    "connection_id": connection_id,
                    "data": base64.b64encode(data).decode("ascii"),
                },
            })

        dead: list[asyncio.StreamWriter] = []
        for writer in list(subs):
            try:
                writer.write(msg)
                # Use a timeout so one slow/stuck subscriber doesn't block
                # output delivery to others.
                await asyncio.wait_for(writer.drain(), timeout=2.0)
            except Exception:
                dead.append(writer)
        for w in dead:
            subs.discard(w)

    return _broadcast


# ---------------------------------------------------------------------------
# IPC method dispatch
# ---------------------------------------------------------------------------

async def _handle_request(method: str, params: dict, writer: asyncio.StreamWriter) -> dict:
    """Dispatch an IPC request to the appropriate manager and return a result dict."""

    # ----- SSH connection lifecycle -----
    if method == "connect":
        try:
            connection_id = await ssh_manager.connect(
                user_id=params["user_id"],
                host=params["host"],
                port=params["port"],
                username=params["username"],
                password=params.get("password"),
                ssh_key=params.get("ssh_key"),
                passphrase=params.get("passphrase"),
                term_type=params.get("term_type", "xterm-256color"),
                cols=params.get("cols", 80),
                rows=params.get("rows", 24),
                known_host_keys=params.get("known_host_keys"),
            )
        except HostKeyVerificationRequired as e:
            return {
                "host_key_verify": True,
                "key_type": e.key_type,
                "fingerprint": e.fingerprint,
                "status": e.status,
            }
        except AuthenticationFailed as e:
            return {"auth_failed": True, "message": str(e)}

        ssh_manager.start_reading(connection_id)
        # Immediately install the IPC broadcast callback so output is
        # forwarded to any subscriber as soon as one appears.
        ssh_manager.register_ws_callback(
            connection_id, _make_ipc_callback(connection_id)
        )
        return {"connection_id": connection_id}

    if method == "disconnect":
        await ssh_manager.disconnect(params["connection_id"])
        return {"ok": True}

    if method == "get_connection_info":
        conn = await ssh_manager.get_connection(params["connection_id"])
        if conn is None:
            return {"exists": False, "user_id": None, "disconnected_reason": None}
        return {
            "exists": True,
            "user_id": conn.user_id,
            "disconnected_reason": conn.disconnected_reason,
        }

    if method == "get_buffered_output":
        buf = ssh_manager.get_buffered_output(params["connection_id"])
        return {"data": base64.b64encode(buf).decode("ascii")}

    # ----- Terminal I/O -----
    if method == "send_data":
        data = base64.b64decode(params["data"])
        await ssh_manager.send_data(params["connection_id"], data)
        return {"ok": True}

    if method == "resize":
        await ssh_manager.resize(
            params["connection_id"],
            params["cols"],
            params["rows"],
        )
        return {"ok": True}

    # ----- Streaming subscription -----
    if method == "subscribe":
        conn_id = params["connection_id"]
        _add_subscriber(conn_id, writer)
        ssh_manager.mark_subscribed(conn_id)
        sub_count = len(_subscribers.get(conn_id, set()))
        logger.info(
            "SSH process subscribe: conn=%s ipc_subscribers=%d writer_id=%d",
            conn_id[:8], sub_count, id(writer),
        )
        # Make sure the broadcast callback is installed (idempotent for
        # connections created via the ``connect`` method, but necessary
        # when a worker subscribes to a connection that was originally
        # created by a different worker — or after a reconnect).
        conn = await ssh_manager.get_connection(conn_id)
        if conn is not None:
            ssh_manager.register_ws_callback(
                conn_id, _make_ipc_callback(conn_id)
            )
        else:
            logger.warning(
                "SSH process subscribe: conn=%s NOT FOUND — callback not installed",
                conn_id[:8],
            )
        return {"ok": True}

    if method == "unsubscribe":
        conn_id = params["connection_id"]
        _remove_subscriber(conn_id, writer)
        remaining = len(_subscribers.get(conn_id, set()))
        logger.info(
            "SSH process unsubscribe: conn=%s remaining_ipc_subs=%d",
            conn_id[:8], remaining,
        )
        # If no more subscribers remain, mark the connection as orphaned
        # so cleanup_stale() can eventually reclaim it.
        if conn_id not in _subscribers:
            ssh_manager.mark_unsubscribed(conn_id)
        return {"ok": True}

    # ----- Command execution (metrics, history) -----
    if method == "run_command":
        conn = await ssh_manager.get_connection(params["connection_id"])
        if conn is None:
            return {"error": "Connection not found"}
        timeout = params.get("timeout", 5)
        try:
            result = await conn.connection.run(
                params["command"], check=False, timeout=timeout,
            )
            return {
                "stdout": result.stdout or "",
                "stderr": result.stderr or "",
                "exit_status": result.exit_status,
            }
        except Exception as e:
            return {"error": str(e)}

    # ----- SFTP operations -----
    if method == "sftp_open":
        conn = await ssh_manager.get_connection(params["connection_id"])
        if conn is None:
            return {"error": "Connection not found"}
        await sftp_manager.get_sftp_client(params["connection_id"], conn.connection)
        return {"ok": True}

    if method == "sftp_home":
        home = await sftp_manager.get_home_directory(params["connection_id"])
        return {"path": home}

    if method == "sftp_ls":
        entries = await sftp_manager.list_directory(
            params["connection_id"], params["path"],
        )
        return {"entries": entries}

    if method == "sftp_stat":
        info = await sftp_manager.stat(params["connection_id"], params["path"])
        return {"info": info}

    if method == "sftp_read":
        max_size = params.get("max_size", 10 * 1024 * 1024)
        content = await sftp_manager.read_file(
            params["connection_id"], params["path"], max_size,
        )
        return {"data": base64.b64encode(content).decode("ascii")}

    if method == "sftp_write":
        content = base64.b64decode(params["data"])
        await sftp_manager.write_file(
            params["connection_id"], params["path"], content,
        )
        return {"ok": True}

    if method == "sftp_mkdir":
        await sftp_manager.mkdir(params["connection_id"], params["path"])
        return {"ok": True}

    if method == "sftp_rename":
        await sftp_manager.rename(
            params["connection_id"],
            params["old_path"],
            params["new_path"],
        )
        return {"ok": True}

    if method == "sftp_remove":
        await sftp_manager.remove(params["connection_id"], params["path"])
        return {"ok": True}

    if method == "sftp_chmod":
        await sftp_manager.chmod(
            params["connection_id"],
            params["path"],
            params["mode"],
        )
        return {"ok": True}

    if method == "sftp_close":
        await sftp_manager.close(params["connection_id"])
        return {"ok": True}

    # ----- Session management -----
    if method == "session_has_capacity":
        ok = session_manager.has_capacity(
            params["user_id"], params["max_sessions"],
        )
        return {"ok": ok}

    if method == "session_register":
        session_manager.register_session(
            user_id=params["user_id"],
            tab_id=params["tab_id"],
            connection_id=params["connection_id"],
            session_type=params["session_type"],
            session_id=params.get("session_id"),
        )
        return {"ok": True}

    if method == "session_unregister":
        session_manager.unregister_session(
            params["user_id"], params["tab_id"],
        )
        return {"ok": True}

    if method == "session_list":
        user_id = params.get("user_id")
        if user_id is not None:
            sessions = session_manager.get_user_sessions(user_id)
        else:
            sessions = []
        return {"sessions": sessions}

    if method == "session_find_by_saved_id":
        sessions = session_manager.get_connections_by_session_id(
            params["user_id"], params["session_id"],
        )
        return {"sessions": sessions}

    if method == "list_connections":
        return {"connection_ids": list(ssh_manager._connections.keys())}

    return {"error": f"Unknown method: {method}"}


# ---------------------------------------------------------------------------
# Per-client handler
# ---------------------------------------------------------------------------

async def _handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """Handle a single worker connection over the Unix socket."""
    peer = writer.get_extra_info("peername") or "unknown"
    logger.info("Worker connected: %s", peer)

    try:
        while True:
            try:
                msg = await read_message(reader)
            except (asyncio.IncompleteReadError, ConnectionResetError):
                break
            if msg is None:
                break

            msg_id = msg.get("id")
            method = msg.get("method", "")
            params = msg.get("params", {})

            try:
                result = await _handle_request(method, params, writer)
                response = {"id": msg_id, "result": result}
            except Exception as e:
                logger.error("IPC error handling %s: %s", method, e, exc_info=True)
                response = {"id": msg_id, "error": str(e)}

            try:
                writer.write(encode_message(response))
                await writer.drain()
            except Exception:
                break
    finally:
        # Clean up all subscriptions owned by this writer.
        for conn_id in list(_subscribers.keys()):
            _remove_subscriber(conn_id, writer)
            # If no more subscribers remain, mark the connection as
            # orphaned so cleanup_stale() can eventually reclaim it.
            if conn_id not in _subscribers:
                ssh_manager.mark_unsubscribed(conn_id)

        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        logger.info("Worker disconnected: %s", peer)


# ---------------------------------------------------------------------------
# Stale session cleanup (runs inside this process)
# ---------------------------------------------------------------------------

async def _cleanup_loop():
    """Periodically remove stale SSH connections."""
    while True:
        try:
            await ssh_manager.cleanup_stale(config.keep_alive_minutes)
        except Exception as e:
            logger.error("Session cleanup error: %s", e)
        await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def _run():
    """Start the Unix socket server and cleanup task."""
    # Ensure data directory exists.
    os.makedirs(os.path.dirname(IPC_SOCKET_PATH), exist_ok=True)

    # Remove stale socket file from a previous run.
    if os.path.exists(IPC_SOCKET_PATH):
        os.unlink(IPC_SOCKET_PATH)

    server = await asyncio.start_unix_server(_handle_client, path=IPC_SOCKET_PATH)
    # Make socket accessible to all workers (they run as the same user).
    os.chmod(IPC_SOCKET_PATH, 0o700)

    cleanup_task = asyncio.create_task(_cleanup_loop())

    logger.info("SSH manager process listening on %s", IPC_SOCKET_PATH)

    stop = asyncio.Event()

    def _signal_handler():
        logger.info("SSH manager process received shutdown signal")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _signal_handler)

    await stop.wait()

    # Graceful shutdown.
    cleanup_task.cancel()
    server.close()
    await server.wait_closed()

    # Disconnect all active SSH connections.
    for conn_id in list(ssh_manager._connections.keys()):
        try:
            await ssh_manager.disconnect(conn_id)
        except Exception:
            pass

    # Remove socket file.
    if os.path.exists(IPC_SOCKET_PATH):
        os.unlink(IPC_SOCKET_PATH)

    # Remove PID file.
    pid_file = os.path.join(os.path.dirname(IPC_SOCKET_PATH), "ssh_manager.pid")
    try:
        os.unlink(pid_file)
    except FileNotFoundError:
        pass

    logger.info("SSH manager process stopped")


def run_ssh_process():
    """Entry point for multiprocessing.Process (or direct invocation).

    On Linux, sets PR_SET_PDEATHSIG so the kernel automatically sends
    SIGTERM to this process when the parent (uvicorn master) dies — even
    on SIGKILL.  This is the most reliable guard against orphaned SSH
    manager processes lingering across restarts.
    """
    # --- Linux: request SIGTERM when parent dies ---
    try:
        import ctypes
        import ctypes.util

        _PR_SET_PDEATHSIG = 1
        libc_name = ctypes.util.find_library("c")
        if libc_name:
            libc = ctypes.CDLL(libc_name, use_errno=True)
            result = libc.prctl(_PR_SET_PDEATHSIG, signal.SIGTERM, 0, 0, 0)
            if result == 0:
                logger.info("PR_SET_PDEATHSIG set — will auto-terminate when parent exits")
            else:
                logger.debug("prctl(PR_SET_PDEATHSIG) returned %d", result)
    except Exception as exc:
        # Non-Linux platforms (macOS, FreeBSD) don't support prctl;
        # fall back to daemon=True + signal handlers in run.py.
        logger.debug("PR_SET_PDEATHSIG not available: %s", exc)

    # --- Write our PID to the PID file as a backup ---
    pid_file = os.path.join(os.path.dirname(IPC_SOCKET_PATH), "ssh_manager.pid")
    try:
        with open(pid_file, "w") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass

    asyncio.run(_run())


if __name__ == "__main__":
    run_ssh_process()
