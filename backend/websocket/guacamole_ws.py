"""Guacamole WebSocket proxy for RDP and VNC connections."""

import asyncio
import json
import logging
import socket
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from guacamole.client import GuacamoleClient
from sqlalchemy import select

from backend.config import config
from backend.database import async_session_factory
from backend.middleware.auth import get_user_from_token
from backend.models.session import SavedSession
from backend.services.session_manager import session_manager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
        logger.error("Failed to look up saved session %s: %s", session_id, e)
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
        logger.warning("Failed to update last_connected for session %s: %s", session_id, e)


def _parse_resolution(resolution: str) -> tuple[int, int]:
    """Parse a resolution string like '1920x1080' into (width, height).

    Returns (1024, 768) as default for invalid or 'Auto' values.
    """
    if not resolution or resolution.lower() == "auto":
        return 1024, 768
    try:
        parts = resolution.lower().split("x")
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError):
        return 1024, 768


def _parse_protocol_settings(json_str: str | None) -> dict:
    """Parse the protocol_settings_json column into a dict."""
    if not json_str:
        return {}
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, TypeError):
        return {}


# ---------------------------------------------------------------------------
# guacd relay tasks
# ---------------------------------------------------------------------------

async def _guacd_to_ws(
    guac_client: GuacamoleClient,
    websocket: WebSocket,
    connection_id: str,
) -> None:
    """Read instructions from guacd and forward to the WebSocket.

    Runs in a loop, using asyncio.to_thread for the blocking guacd reads.
    """
    try:
        while True:
            instruction = await asyncio.to_thread(guac_client.receive)
            if not instruction:
                logger.warning("guacd closed connection %s (remote side hung up)", connection_id[:8])
                break
            await websocket.send_text(instruction)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning("guacd->ws relay ended for %s: %s", connection_id[:8], e)


async def _ws_to_guacd(
    guac_client: GuacamoleClient,
    websocket: WebSocket,
    connection_id: str,
) -> None:
    """Read instructions from the WebSocket and forward to guacd.

    Runs in a loop, forwarding raw Guacamole protocol strings.
    """
    try:
        while True:
            data = await websocket.receive_text()
            await asyncio.to_thread(guac_client.send, data)
    except (asyncio.CancelledError, WebSocketDisconnect):
        pass
    except Exception as e:
        logger.warning("ws->guacd relay ended for %s: %s", connection_id[:8], e)


# ---------------------------------------------------------------------------
# Main WebSocket handler
# ---------------------------------------------------------------------------

async def guacamole_websocket_handler(
    websocket: WebSocket,
):
    """Handle RDP/VNC WebSocket connections via Apache Guacamole (guacd).

    Protocol:
    Phase 1 — JSON handshake (before guacd connection):
    - Client sends: {type: "auth", token: "jwt_token"} (if not in query)
    - Client sends: {type: "connect", protocol: "rdp"|"vnc", host, port,
                      username?, password?, domain?, width?, height?,
                      session_id?, tab_id?}
    - Server sends: {type: "connected", connection_id: "..."}
    - Server sends: {type: "error", message: "..."} on failure

    Phase 2 — Raw Guacamole protocol relay:
    - Client sends raw Guacamole instructions (mouse, key, size, etc.)
    - Server sends raw Guacamole instructions (img, size, cursor, etc.)
    """
    await websocket.accept()

    user_id: str | None = None
    username: str | None = None
    connection_id: str | None = None
    guac_client: GuacamoleClient | None = None
    relay_task_g2w: asyncio.Task | None = None
    relay_task_w2g: asyncio.Task | None = None

    try:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            msg = json.loads(raw)
            if msg.get("type") == "auth":
                payload, user = await get_user_from_token(msg.get("token", ""))
                user_id = str(user.id)
                username = payload.get("username") or user.username
                await websocket.send_json({"type": "authenticated", "username": username})
            else:
                await websocket.send_json({"type": "error", "message": "Authentication required"})
                await websocket.close(code=4001)
                return
        except asyncio.TimeoutError:
            await websocket.close(code=4001)
            return
        except Exception:
            await websocket.send_json({"type": "error", "message": "Authentication failed"})
            await websocket.close(code=4001)
            return

        # Phase 1: JSON message loop — wait for connect messages
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                return

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            # Auth message (fallback if token not in query)
            if msg_type == "auth":
                try:
                    payload, user = await get_user_from_token(msg.get("token", ""))
                    user_id = str(user.id)
                    username = payload.get("username") or user.username
                    await websocket.send_json({"type": "authenticated", "username": username})
                except Exception:
                    await websocket.send_json({"type": "error", "message": "Authentication failed"})
                    await websocket.close(code=4001)
                    return

            # Connect to remote host via guacd
            elif msg_type == "connect":
                if not user_id:
                    await websocket.send_json({"type": "error", "message": "Not authenticated"})
                    continue

                # Check if guacd is enabled
                if not config.guacd_enabled:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Remote desktop support is not enabled. Configure guacd in config.yaml.",
                    })
                    continue

                # Check capacity
                if not session_manager.has_capacity(user_id, config.max_active_per_user):
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Maximum active sessions ({config.max_active_per_user}) reached",
                    })
                    continue

                protocol = msg.get("protocol", "rdp")
                if protocol not in ("rdp", "vnc"):
                    await websocket.send_json({"type": "error", "message": f"Unsupported protocol: {protocol}"})
                    continue

                try:
                    # Resolve connection details
                    host = msg.get("host", "")
                    port = int(msg.get("port", 3389 if protocol == "rdp" else 5900))
                    conn_username = msg.get("username", "")
                    password = msg.get("password")
                    domain = msg.get("domain", "")
                    width = int(msg.get("width", 1024))
                    height = int(msg.get("height", 768))
                    dpi = int(msg.get("dpi", 96))
                    session_id = msg.get("sessionId") or msg.get("session_id")
                    tab_id = msg.get("tab_id", "")

                    # Look up saved session for missing credentials
                    if session_id:
                        saved = await _lookup_saved_session(session_id, user_id)
                        if saved:
                            host = host or saved.host
                            port = port or saved.port
                            conn_username = conn_username or saved.username or ""

                            # Parse protocol settings for domain/resolution
                            proto_settings = _parse_protocol_settings(saved.protocol_settings_json)
                            if not domain:
                                domain = proto_settings.get("domain", "")
                            if width == 1024 and height == 768:
                                res_str = proto_settings.get("resolution", "")
                                if res_str:
                                    width, height = _parse_resolution(res_str)

                            await _touch_last_connected(session_id)

                    if not host:
                        await websocket.send_json({"type": "error", "message": "Host is required"})
                        continue

                    # Generate a connection ID
                    connection_id = str(uuid.uuid4())

                    logger.info(
                        "Guacamole %s connect: user=%s host=%s:%d conn=%s",
                        protocol.upper(), str(user_id)[:8], host, port, connection_id[:8],
                    )

                    # Create guacd client connection (blocking — run in thread)
                    guac_client = GuacamoleClient(
                        config.guacd_host,
                        config.guacd_port,
                        timeout=20,
                    )

                    # Build handshake kwargs based on protocol
                    handshake_kwargs: dict = {
                        "hostname": host,
                        "port": str(port),
                    }

                    if protocol == "rdp":
                        if conn_username:
                            handshake_kwargs["username"] = conn_username
                        if password:
                            handshake_kwargs["password"] = password
                        if domain:
                            handshake_kwargs["domain"] = domain
                        # RDP-specific settings
                        # NOTE: pyguacamole converts guacd arg names from
                        # hyphens to underscores before kwarg lookup, so
                        # these keys MUST use underscores, not hyphens.
                        handshake_kwargs["security"] = config.rdp_security_mode
                        if config.rdp_ignore_cert:
                            handshake_kwargs["ignore_cert"] = "true"
                        handshake_kwargs["disable_audio"] = "true"
                        handshake_kwargs["enable_wallpaper"] = "false"
                        handshake_kwargs["enable_theming"] = "true"
                        handshake_kwargs["enable_font_smoothing"] = "true"
                        handshake_kwargs["create_drive_path"] = "true"
                        handshake_kwargs["resize_method"] = "display-update"
                    elif protocol == "vnc":
                        if password:
                            handshake_kwargs["password"] = password

                    # Perform the guacd handshake (blocking)
                    await asyncio.to_thread(
                        guac_client.handshake,
                        protocol=protocol,
                        width=width,
                        height=height,
                        dpi=dpi,
                        **handshake_kwargs,
                    )

                    # Clear the socket timeout for the relay phase.
                    # The timeout was only needed for the handshake;
                    # during relay, guacd sends nop keep-alives and
                    # the connection should run indefinitely.
                    guac_client._client.settimeout(None)

                    # Register in session manager
                    session_manager.register_session(
                        user_id=user_id,
                        tab_id=tab_id,
                        connection_id=connection_id,
                        session_type=protocol,
                        session_id=session_id,
                    )

                    # Send connected message to the client
                    await websocket.send_json({
                        "type": "connected",
                        "connection_id": connection_id,
                    })

                    logger.info(
                        "Guacamole %s connected: conn=%s guacd_id=%s",
                        protocol.upper(), connection_id[:8], guac_client.id,
                    )

                    # Phase 2: start the bidirectional relay
                    relay_task_g2w = asyncio.create_task(
                        _guacd_to_ws(guac_client, websocket, connection_id)
                    )
                    relay_task_w2g = asyncio.create_task(
                        _ws_to_guacd(guac_client, websocket, connection_id)
                    )

                    # Wait for either relay task to end (means connection is done)
                    done, pending = await asyncio.wait(
                        [relay_task_g2w, relay_task_w2g],
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    # Cancel the other task
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except (asyncio.CancelledError, Exception):
                            pass

                    # Connection ended — exit the handler
                    break

                except Exception as e:
                    logger.error("Guacamole connect error: %s", e)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Connection failed: {str(e)}",
                    })

            # Keepalive
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("Guacamole WebSocket error: %s", e)
    finally:
        # Force-close the underlying guacd socket first.  This unblocks
        # any blocking recv()/sendall() calls stuck inside to_thread(),
        # which cannot be interrupted by asyncio task cancellation alone.
        if guac_client and guac_client._client:
            try:
                guac_client._client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                guac_client._client.close()
            except OSError:
                pass

        # Now cancel relay tasks — they will exit quickly since the
        # socket is already closed.
        for task in (relay_task_g2w, relay_task_w2g):
            if task and not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=2)
                except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                    pass

        # Unregister from session manager
        if connection_id:
            session_manager.unregister_by_connection_id(connection_id)

        logger.info(
            "Guacamole WebSocket closed for user %s, connection %s",
            user_id, connection_id,
        )
