"""SSH WebSocket endpoint handler."""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select, and_

from backend.config import config
from backend.database import async_session_factory
from backend.middleware.auth import verify_token
from backend.models.known_host import KnownHost
from backend.models.session import SavedSession
from backend.services.ssh_proxy import ssh_proxy

logger = logging.getLogger(__name__)

# Maximum number of password retries before giving up (matches OpenSSH).
MAX_AUTH_RETRIES = 3


@dataclass
class _PendingConnect:
    """Holds connection parameters while waiting for interactive user input.

    Stored on the WebSocket handler so that host_key_response and
    auth_retry messages can re-attempt the connection without the
    client having to re-send all the original credentials.
    """

    host: str = ""
    port: int = 22
    username: str = ""
    password: Optional[str] = None
    ssh_key: Optional[str] = None
    passphrase: Optional[str] = None
    session_id: Optional[str] = None
    tab_id: str = ""
    term_type: str = "xterm-256color"
    cols: int = 80
    rows: int = 24
    auth_attempts: int = 0
    auth_was_retry: bool = False


async def _forward_ssh_to_ws(
    queue: asyncio.Queue,
    websocket: WebSocket,
    connection_id: str,
    ssh_proxy,
) -> None:
    """Read SSH output from the IPC subscription queue and forward to the WebSocket.

    A ``None`` sentinel in the queue signals that the SSH session has
    ended.  When received, a ``{"type": "disconnected"}`` message is sent
    to the frontend and the forwarder exits.
    """
    ws_id = id(websocket)
    logger.debug("Forward task started: conn=%s ws=%d", connection_id[:8], ws_id)
    try:
        while True:
            data: bytes | None = await queue.get()

            if data is None:
                # SSH session ended — notify the frontend immediately.
                reason = "SSH session ended"
                try:
                    conn = await ssh_proxy.get_connection(connection_id)
                    if conn and conn.disconnected_reason:
                        reason = conn.disconnected_reason
                except Exception:
                    pass
                logger.debug("Forward task: conn=%s ws=%d — session ended", connection_id[:8], ws_id)
                await websocket.send_json({
                    "type": "disconnected",
                    "reason": reason,
                })
                break

            await websocket.send_json({
                "type": "data",
                "data": data.decode("utf-8", errors="replace"),
            })
    except (asyncio.CancelledError, WebSocketDisconnect):
        logger.debug("Forward task stopped: conn=%s ws=%d (cancelled/disconnect)", connection_id[:8], ws_id)
    except Exception as e:
        logger.error("Forward task error: conn=%s ws=%d — %s", connection_id[:8], ws_id, e)


# ---------------------------------------------------------------------------
# Known host key helpers (DB operations run in the uvicorn worker)
# ---------------------------------------------------------------------------

async def _get_known_host_keys(user_id: str, host: str, port: int) -> list[dict]:
    """Load previously accepted host keys from the database.

    Returns:
        List of dicts with ``key_type`` and ``fingerprint`` keys, or an
        empty list if no keys are stored for this host:port.
    """
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(KnownHost).where(
                    and_(
                        KnownHost.user_id == user_id,
                        KnownHost.host == host,
                        KnownHost.port == port,
                    )
                )
            )
            rows = result.scalars().all()
            return [
                {"key_type": r.key_type, "fingerprint": r.fingerprint}
                for r in rows
            ]
    except Exception as e:
        logger.error("Failed to load known host keys: %s", e)
        return []


async def _save_host_key(
    user_id: str, host: str, port: int, key_type: str, fingerprint: str,
) -> None:
    """Insert or update a known host key in the database."""
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(KnownHost).where(
                    and_(
                        KnownHost.user_id == user_id,
                        KnownHost.host == host,
                        KnownHost.port == port,
                        KnownHost.key_type == key_type,
                    )
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                existing.fingerprint = fingerprint
                existing.updated_at = datetime.now(timezone.utc)
            else:
                db.add(KnownHost(
                    user_id=user_id,
                    host=host,
                    port=port,
                    key_type=key_type,
                    fingerprint=fingerprint,
                ))
            await db.commit()
    except Exception as e:
        logger.error("Failed to save known host key: %s", e)


# ---------------------------------------------------------------------------
# Connection attempt helper
# ---------------------------------------------------------------------------

async def _attempt_connect(
    user_id: str,
    pending: _PendingConnect,
    known_host_keys: list[dict],
) -> dict:
    """Call ssh_proxy.connect and return the raw result dict."""
    return await ssh_proxy.connect(
        user_id=user_id,
        host=pending.host,
        port=pending.port,
        username=pending.username,
        password=pending.password,
        ssh_key=pending.ssh_key,
        passphrase=pending.passphrase,
        term_type=pending.term_type,
        cols=pending.cols,
        rows=pending.rows,
        known_host_keys=known_host_keys,
    )


# ---------------------------------------------------------------------------
# Main WebSocket handler
# ---------------------------------------------------------------------------

async def ssh_websocket_handler(
    websocket: WebSocket,
    token: str = Query(default=None),
):
    """Handle SSH terminal WebSocket connections.

    Protocol:
    - Client sends JSON messages with type field:
      - {type: "auth", token: "jwt_token"} - Authenticate (if not in query)
      - {type: "connect", host, port, username, password?, ssh_key?, passphrase?, session_id?, tab_id?}
      - {type: "reconnect", connection_id, tab_id}
      - {type: "host_key_response", accepted: bool} - Accept/reject unknown host key
      - {type: "auth_retry", password: "..."} - Retry with new password
      - {type: "auth_retry_cancel"} - Cancel password retry
      - {type: "data", data: "..."} - Terminal input data
      - {type: "resize", cols: N, rows: N} - Terminal resize
      - {type: "ping"} - Keepalive
    - Server sends JSON messages:
      - {type: "data", data: "..."} - Terminal output
      - {type: "connected", connection_id: "..."} - Connection established
      - {type: "disconnected", reason: "..."} - Connection closed
      - {type: "host_key_verify", host, port, key_type, fingerprint, status} - Host key prompt
      - {type: "auth_failed", message, attempts_remaining} - Auth failed, retry?
      - {type: "error", message: "..."} - Error occurred
      - {type: "pong"} - Keepalive response
    """
    await websocket.accept()

    user_id = None
    username = None
    connection_id = None
    subscription_id: str | None = None
    forward_task: asyncio.Task | None = None

    # Pending connection state for interactive prompts.
    pending: _PendingConnect | None = None
    # Cached known host keys for the current connection attempt.
    cached_known_keys: list[dict] = []

    try:
        # Authenticate via query token or first message
        if token:
            try:
                payload = verify_token(token)
                user_id = payload.get("sub")
                username = payload.get("username")
            except Exception:
                await websocket.send_json({"type": "error", "message": "Invalid authentication token"})
                await websocket.close(code=4001)
                return

        # Main message loop
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                # Treat as raw terminal data if we have a connection
                if connection_id:
                    await ssh_proxy.send_data(connection_id, raw.encode("utf-8"))
                continue

            msg_type = msg.get("type", "")

            # Auth message
            if msg_type == "auth":
                try:
                    payload = verify_token(msg.get("token", ""))
                    user_id = payload.get("sub")
                    username = payload.get("username")
                    await websocket.send_json({"type": "authenticated", "username": username})
                except Exception:
                    await websocket.send_json({"type": "error", "message": "Authentication failed"})
                    await websocket.close(code=4001)
                    return

            # ---------------------------------------------------------
            # Connect to SSH server
            # ---------------------------------------------------------
            elif msg_type == "connect":
                if not user_id:
                    await websocket.send_json({"type": "error", "message": "Not authenticated"})
                    continue

                tab_id = msg.get("tab_id", "")

                # Check capacity
                if not await ssh_proxy.session_has_capacity(user_id, config.max_active_per_user):
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Maximum active sessions ({config.max_active_per_user}) reached"
                    })
                    continue

                try:
                    # Resolve connection details.
                    host = msg.get("host", "")
                    port = int(msg.get("port", 22))
                    conn_username = msg.get("username", "")
                    password = msg.get("password")
                    ssh_key = msg.get("ssh_key") or msg.get("sshKey")
                    passphrase = msg.get("passphrase")
                    session_id = msg.get("sessionId") or msg.get("session_id")

                    if session_id:
                        saved = await _lookup_saved_session(session_id, user_id)
                        if saved:
                            host = host or saved.host
                            port = port or saved.port
                            conn_username = conn_username or saved.username or ""
                            await _touch_last_connected(session_id)

                    # Build pending state for potential retries.
                    pending = _PendingConnect(
                        host=host,
                        port=port,
                        username=conn_username,
                        password=password,
                        ssh_key=ssh_key,
                        passphrase=passphrase,
                        session_id=session_id,
                        tab_id=tab_id,
                        term_type=msg.get("term_type", "xterm-256color"),
                        cols=int(msg.get("cols", 80)),
                        rows=int(msg.get("rows", 24)),
                        auth_attempts=0,
                    )

                    # Load known host keys from the DB.
                    cached_known_keys = await _get_known_host_keys(user_id, host, port)

                    result = await _attempt_connect(user_id, pending, cached_known_keys)

                    # Handle the three possible outcomes.
                    if result.get("host_key_verify"):
                        await websocket.send_json({
                            "type": "host_key_verify",
                            "host": host,
                            "port": port,
                            "key_type": result["key_type"],
                            "fingerprint": result["fingerprint"],
                            "status": result["status"],
                        })
                        # Stay in the loop — wait for host_key_response.
                        continue

                    if result.get("auth_failed"):
                        pending.auth_attempts += 1
                        remaining = MAX_AUTH_RETRIES - pending.auth_attempts
                        await websocket.send_json({
                            "type": "auth_failed",
                            "message": result.get("message", "Permission denied"),
                            "attempts_remaining": remaining,
                        })
                        if remaining <= 0:
                            pending = None
                        continue

                    # Success.
                    connection_id = result["connection_id"]

                    await ssh_proxy.session_register(
                        user_id=user_id,
                        tab_id=tab_id,
                        connection_id=connection_id,
                        session_type="ssh",
                        session_id=pending.session_id,
                    )

                    queue, subscription_id = await ssh_proxy.subscribe(connection_id)
                    forward_task = asyncio.create_task(
                        _forward_ssh_to_ws(queue, websocket, connection_id, ssh_proxy)
                    )

                    connected_msg: dict = {
                        "type": "connected",
                        "connection_id": connection_id,
                    }
                    if pending.session_id and pending.auth_was_retry:
                        connected_msg["session_id"] = pending.session_id
                        connected_msg["auth_was_retry"] = True
                    pending = None

                    await websocket.send_json(connected_msg)

                except Exception as e:
                    logger.error(f"SSH connect error: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Connection failed: {str(e)}",
                    })

            # ---------------------------------------------------------
            # Host key response (user accepted or rejected)
            # ---------------------------------------------------------
            elif msg_type == "host_key_response":
                if not user_id or not pending:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No pending connection to confirm",
                    })
                    continue

                accepted = msg.get("accepted", False)
                if not accepted:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Host key verification rejected by user",
                    })
                    pending = None
                    continue

                # User accepted — save the key and retry.
                key_type = msg.get("key_type", "")
                fingerprint = msg.get("fingerprint", "")
                if key_type and fingerprint:
                    await _save_host_key(
                        user_id, pending.host, pending.port,
                        key_type, fingerprint,
                    )
                    # Update cached keys so the retry succeeds.
                    # Remove any old entries for this key_type, add the new one.
                    cached_known_keys = [
                        k for k in cached_known_keys
                        if k["key_type"] != key_type
                    ]
                    cached_known_keys.append({
                        "key_type": key_type,
                        "fingerprint": fingerprint,
                    })

                try:
                    result = await _attempt_connect(user_id, pending, cached_known_keys)

                    if result.get("auth_failed"):
                        pending.auth_attempts += 1
                        remaining = MAX_AUTH_RETRIES - pending.auth_attempts
                        await websocket.send_json({
                            "type": "auth_failed",
                            "message": result.get("message", "Permission denied"),
                            "attempts_remaining": remaining,
                        })
                        if remaining <= 0:
                            pending = None
                        continue

                    if result.get("host_key_verify"):
                        # Should not happen after accepting, but handle it.
                        await websocket.send_json({
                            "type": "error",
                            "message": "Host key changed unexpectedly during retry",
                        })
                        pending = None
                        continue

                    # Success.
                    connection_id = result["connection_id"]
                    tab_id = pending.tab_id

                    await ssh_proxy.session_register(
                        user_id=user_id,
                        tab_id=tab_id,
                        connection_id=connection_id,
                        session_type="ssh",
                        session_id=pending.session_id,
                    )

                    queue, subscription_id = await ssh_proxy.subscribe(connection_id)
                    forward_task = asyncio.create_task(
                        _forward_ssh_to_ws(queue, websocket, connection_id, ssh_proxy)
                    )

                    connected_msg: dict = {
                        "type": "connected",
                        "connection_id": connection_id,
                    }
                    if pending.session_id and pending.auth_was_retry:
                        connected_msg["session_id"] = pending.session_id
                        connected_msg["auth_was_retry"] = True
                    pending = None

                    await websocket.send_json(connected_msg)

                except Exception as e:
                    logger.error(f"SSH connect error after host key accept: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Connection failed: {str(e)}",
                    })
                    pending = None

            # ---------------------------------------------------------
            # Auth retry (user provided a new password)
            # ---------------------------------------------------------
            elif msg_type == "auth_retry":
                if not user_id or not pending:
                    await websocket.send_json({
                        "type": "error",
                        "message": "No pending connection to retry",
                    })
                    continue

                new_password = msg.get("password", "")
                pending.password = new_password
                # Mark that the user manually entered a password via retry.
                # Set before the attempt so it persists through host_key_verify
                # interruptions — the flag is still relevant when the
                # connection eventually succeeds via host_key_response.
                pending.auth_was_retry = True

                try:
                    result = await _attempt_connect(user_id, pending, cached_known_keys)

                    if result.get("auth_failed"):
                        pending.auth_attempts += 1
                        remaining = MAX_AUTH_RETRIES - pending.auth_attempts
                        await websocket.send_json({
                            "type": "auth_failed",
                            "message": result.get("message", "Permission denied"),
                            "attempts_remaining": remaining,
                        })
                        if remaining <= 0:
                            pending = None
                        continue

                    if result.get("host_key_verify"):
                        await websocket.send_json({
                            "type": "host_key_verify",
                            "host": pending.host,
                            "port": pending.port,
                            "key_type": result["key_type"],
                            "fingerprint": result["fingerprint"],
                            "status": result["status"],
                        })
                        continue

                    # Success.
                    connection_id = result["connection_id"]
                    tab_id = pending.tab_id

                    await ssh_proxy.session_register(
                        user_id=user_id,
                        tab_id=tab_id,
                        connection_id=connection_id,
                        session_type="ssh",
                        session_id=pending.session_id,
                    )

                    queue, subscription_id = await ssh_proxy.subscribe(connection_id)
                    forward_task = asyncio.create_task(
                        _forward_ssh_to_ws(queue, websocket, connection_id, ssh_proxy)
                    )

                    connected_msg: dict = {
                        "type": "connected",
                        "connection_id": connection_id,
                    }
                    if pending.session_id:
                        connected_msg["session_id"] = pending.session_id
                        connected_msg["auth_was_retry"] = True
                    pending = None

                    await websocket.send_json(connected_msg)

                except Exception as e:
                    logger.error(f"SSH connect error on auth retry: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Connection failed: {str(e)}",
                    })
                    pending = None

            # ---------------------------------------------------------
            # Auth retry cancel
            # ---------------------------------------------------------
            elif msg_type == "auth_retry_cancel":
                if pending:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Authentication cancelled by user",
                    })
                    pending = None

            # ---------------------------------------------------------
            # Reconnect to existing SSH session
            # ---------------------------------------------------------
            elif msg_type == "reconnect":
                if not user_id:
                    await websocket.send_json({"type": "error", "message": "Not authenticated"})
                    continue

                recon_id = msg.get("connection_id", "")
                tab_id = msg.get("tab_id", "")
                logger.info(
                    "Reconnect request: conn=%s user=%s tab=%s ws=%d",
                    recon_id[:8], str(user_id)[:8], tab_id[:8] if tab_id else "?",
                    id(websocket),
                )
                conn = await ssh_proxy.get_connection(recon_id)

                if conn and conn.user_id == user_id:
                    connection_id = recon_id

                    # Replay buffered scrollback so the terminal is
                    # restored with previous output before showing the
                    # reconnected banner.
                    buffered = await ssh_proxy.get_buffered_output(connection_id)
                    if buffered:
                        await websocket.send_json({
                            "type": "data",
                            "data": buffered.decode("utf-8", errors="replace"),
                        })

                    # If the SSH process exited while disconnected, tell
                    # the client after replaying the buffer.
                    if conn.disconnected_reason:
                        await websocket.send_json({
                            "type": "disconnected",
                            "reason": conn.disconnected_reason,
                        })
                        continue

                    # Subscribe to live SSH output and start forwarding.
                    queue, subscription_id = await ssh_proxy.subscribe(connection_id)
                    if forward_task and not forward_task.done():
                        forward_task.cancel()
                    forward_task = asyncio.create_task(
                        _forward_ssh_to_ws(queue, websocket, connection_id, ssh_proxy)
                    )

                    await websocket.send_json({
                        "type": "connected",
                        "connection_id": connection_id,
                        "reconnected": True,
                    })

                    # Send an empty newline to the shell so it re-prints
                    # the prompt.
                    try:
                        await ssh_proxy.send_data(connection_id, b"\n")
                    except Exception:
                        pass
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Session not found or expired",
                    })

            # Terminal data
            elif msg_type == "data":
                if connection_id:
                    data = msg.get("data", "")
                    await ssh_proxy.send_data(connection_id, data.encode("utf-8"))

            # Terminal resize
            elif msg_type == "resize":
                if connection_id:
                    cols = int(msg.get("cols", 80))
                    rows = int(msg.get("rows", 24))
                    await ssh_proxy.resize(connection_id, cols, rows)

            # Keepalive — also acts as a safety net for detecting SSH
            # disconnections that the sentinel mechanism may have missed.
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                if connection_id:
                    try:
                        conn = await ssh_proxy.get_connection(connection_id)
                        if conn and conn.disconnected_reason:
                            await websocket.send_json({
                                "type": "disconnected",
                                "reason": conn.disconnected_reason,
                            })
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"SSH WebSocket error: {e}")
    finally:
        # Cancel the forwarding task.
        if forward_task and not forward_task.done():
            forward_task.cancel()

        # Unsubscribe this specific WebSocket's subscription from IPC
        # streaming but keep the SSH session alive for potential
        # reconnection.  Other attached tabs retain their subscriptions.
        if connection_id:
            await ssh_proxy.unsubscribe(connection_id, subscription_id)

        # Note: We do NOT disconnect the SSH session here.
        # The session stays alive for reconnection within keep_alive_minutes.
        logger.info(f"SSH WebSocket closed for user {user_id}, connection {connection_id}")


async def _lookup_saved_session(session_id: str, user_id: str) -> SavedSession | None:
    """Fetch a saved session from the DB and verify it belongs to the user."""
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(SavedSession).where(SavedSession.id == session_id)
            )
            saved = result.scalar_one_or_none()
        if saved and str(saved.user_id) == str(user_id):
            return saved
        return None
    except Exception as e:
        logger.error(f"Failed to look up saved session {session_id}: {e}")
        return None


async def _touch_last_connected(session_id: str) -> None:
    """Update the last_connected timestamp on a saved session."""
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(SavedSession).where(SavedSession.id == session_id)
            )
            saved = result.scalar_one_or_none()
            if saved:
                saved.last_connected = datetime.now(timezone.utc)
                await db.commit()
    except Exception as e:
        logger.warning(f"Failed to update last_connected for session {session_id}: {e}")
