"""Worker-side proxy for the dedicated SSH manager process.

Provides the same public API as ``SSHConnectionManager`` but forwards
every call over a Unix domain socket to the SSH manager process.
"""

import asyncio
import base64
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from backend.services.ipc_protocol import IPC_SOCKET_PATH, encode_message, read_message

logger = logging.getLogger(__name__)


@dataclass
class SSHConnectionInfo:
    """Serializable subset of SSHConnection returned by get_connection_info."""

    user_id: str | None = None
    disconnected_reason: str | None = None
    exists: bool = True


class SSHProxy:
    """Worker-side proxy that talks to the SSH manager process via IPC.

    Each uvicorn worker creates a single instance and connects during
    the application lifespan startup.
    """

    def __init__(self):
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._subscriptions: dict[str, asyncio.Queue] = {}
        self._read_task: asyncio.Task | None = None
        self._connected = False

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect_to_process(self, retries: int = 30, delay: float = 0.5):
        """Establish the IPC connection to the SSH manager process.

        Args:
            retries: Number of connection attempts before giving up.
            delay: Seconds between attempts.
        """
        for attempt in range(retries):
            try:
                self._reader, self._writer = await asyncio.open_unix_connection(
                    IPC_SOCKET_PATH
                )
                self._connected = True
                self._read_task = asyncio.create_task(self._read_loop())
                logger.info("Connected to SSH manager process")
                return
            except (FileNotFoundError, ConnectionRefusedError):
                if attempt < retries - 1:
                    await asyncio.sleep(delay)
                else:
                    raise RuntimeError(
                        f"Failed to connect to SSH manager process at "
                        f"{IPC_SOCKET_PATH} after {retries} attempts"
                    )

    async def close(self):
        """Close the IPC connection."""
        self._connected = False
        if self._read_task:
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
        # Resolve any pending futures with errors.
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(ConnectionError("IPC connection closed"))
        self._pending.clear()

    # ------------------------------------------------------------------
    # Internal read loop — dispatches responses and stream pushes
    # ------------------------------------------------------------------

    async def _read_loop(self):
        """Continuously read from the IPC socket, dispatch responses and streams."""
        try:
            while self._connected and self._reader:
                try:
                    msg = await read_message(self._reader)
                except (asyncio.IncompleteReadError, ConnectionResetError):
                    break
                if msg is None:
                    break

                msg_id = msg.get("id")

                # Stream push (id is None) — route to subscription queue.
                if msg_id is None and msg.get("method") == "stream":
                    params = msg.get("params", {})
                    conn_id = params.get("connection_id", "")
                    queue = self._subscriptions.get(conn_id)
                    if queue is not None:
                        data = base64.b64decode(params.get("data", ""))
                        try:
                            queue.put_nowait(data)
                        except asyncio.QueueFull:
                            pass  # Drop if consumer is too slow.
                    continue

                # Regular response — resolve the pending future.
                key: str = str(msg_id) if msg_id is not None else ""
                fut = self._pending.pop(key, None) if key else None
                if fut is not None and not fut.done():
                    if "error" in msg and msg["error"] is not None:
                        fut.set_exception(RuntimeError(msg["error"]))
                    else:
                        fut.set_result(msg.get("result", {}))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("IPC read loop error: %s", e)
        finally:
            # Fail any remaining pending requests.
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("IPC connection lost"))
            self._pending.clear()

    # ------------------------------------------------------------------
    # Internal request helper
    # ------------------------------------------------------------------

    async def _request(self, method: str, **params: Any) -> dict:
        """Send a request and await the response."""
        if not self._connected or not self._writer:
            raise ConnectionError("Not connected to SSH manager process")

        msg_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[msg_id] = fut

        msg = encode_message({"id": msg_id, "method": method, "params": params})
        self._writer.write(msg)
        await self._writer.drain()

        return await fut

    # ------------------------------------------------------------------
    # SSH connection lifecycle (mirrors SSHConnectionManager)
    # ------------------------------------------------------------------

    async def connect(
        self,
        user_id,
        host: str,
        port: int,
        username: str,
        password: str | None = None,
        ssh_key: str | None = None,
        passphrase: str | None = None,
        term_type: str = "xterm-256color",
        cols: int = 80,
        rows: int = 24,
        known_host_keys: list[dict] | None = None,
    ) -> dict:
        """Create an SSH connection via the manager process.

        Returns:
            A dict that always contains one of:
            - ``{"connection_id": "..."}`` on success.
            - ``{"host_key_verify": True, "key_type": ..., "fingerprint": ..., "status": ...}``
              when the server's host key needs user approval.
            - ``{"auth_failed": True, "message": ...}`` when authentication
              was rejected (wrong password / key).
        """
        result = await self._request(
            "connect",
            user_id=user_id,
            host=host,
            port=port,
            username=username,
            password=password,
            ssh_key=ssh_key,
            passphrase=passphrase,
            term_type=term_type,
            cols=cols,
            rows=rows,
            known_host_keys=known_host_keys or [],
        )
        return result

    async def disconnect(self, connection_id: str) -> None:
        """Close an SSH connection."""
        await self._request("disconnect", connection_id=connection_id)

    async def get_connection(self, connection_id: str) -> SSHConnectionInfo | None:
        """Retrieve connection metadata.

        Returns an ``SSHConnectionInfo`` (with user_id and
        disconnected_reason) or ``None`` if the connection doesn't exist.
        """
        result = await self._request("get_connection_info", connection_id=connection_id)
        if not result.get("exists"):
            return None
        return SSHConnectionInfo(
            user_id=result.get("user_id"),
            disconnected_reason=result.get("disconnected_reason"),
        )

    async def get_buffered_output(self, connection_id: str) -> bytes:
        """Return the scrollback buffer for a connection."""
        result = await self._request("get_buffered_output", connection_id=connection_id)
        return base64.b64decode(result.get("data", ""))

    # ------------------------------------------------------------------
    # Terminal I/O
    # ------------------------------------------------------------------

    async def send_data(self, connection_id: str, data: bytes) -> None:
        """Write data to the SSH channel stdin."""
        await self._request(
            "send_data",
            connection_id=connection_id,
            data=base64.b64encode(data).decode("ascii"),
        )

    async def resize(self, connection_id: str, cols: int, rows: int) -> None:
        """Resize the PTY."""
        await self._request(
            "resize", connection_id=connection_id, cols=cols, rows=rows,
        )

    # ------------------------------------------------------------------
    # Streaming subscription
    # ------------------------------------------------------------------

    async def subscribe(self, connection_id: str) -> asyncio.Queue:
        """Subscribe to live SSH output for a connection.

        Returns an asyncio.Queue that receives ``bytes`` chunks as the
        SSH process produces output.
        """
        queue: asyncio.Queue = asyncio.Queue(maxsize=1024)
        self._subscriptions[connection_id] = queue
        await self._request("subscribe", connection_id=connection_id)
        return queue

    async def unsubscribe(self, connection_id: str) -> None:
        """Stop receiving SSH output for a connection."""
        self._subscriptions.pop(connection_id, None)
        try:
            await self._request("unsubscribe", connection_id=connection_id)
        except Exception:
            pass  # Best-effort; the connection may already be gone.

    # ------------------------------------------------------------------
    # Command execution (for metrics, remote history)
    # ------------------------------------------------------------------

    async def run_command(
        self, connection_id: str, command: str, timeout: int = 5,
    ) -> dict:
        """Execute a command on the remote server.

        Returns:
            Dict with keys ``stdout``, ``stderr``, ``exit_status``.
            May contain ``error`` key on failure.
        """
        return await self._request(
            "run_command",
            connection_id=connection_id,
            command=command,
            timeout=timeout,
        )

    # ------------------------------------------------------------------
    # SFTP operations
    # ------------------------------------------------------------------

    async def sftp_open(self, connection_id: str) -> None:
        """Ensure an SFTP subsystem is open for a connection."""
        await self._request("sftp_open", connection_id=connection_id)

    async def sftp_home(self, connection_id: str) -> str:
        result = await self._request("sftp_home", connection_id=connection_id)
        return result["path"]

    async def sftp_ls(self, connection_id: str, path: str) -> list[dict]:
        result = await self._request("sftp_ls", connection_id=connection_id, path=path)
        return result["entries"]

    async def sftp_stat(self, connection_id: str, path: str) -> dict:
        result = await self._request("sftp_stat", connection_id=connection_id, path=path)
        return result["info"]

    async def sftp_read(
        self, connection_id: str, path: str, max_size: int = 10 * 1024 * 1024,
    ) -> bytes:
        result = await self._request(
            "sftp_read", connection_id=connection_id, path=path, max_size=max_size,
        )
        return base64.b64decode(result.get("data", ""))

    async def sftp_write(self, connection_id: str, path: str, content: bytes) -> None:
        await self._request(
            "sftp_write",
            connection_id=connection_id,
            path=path,
            data=base64.b64encode(content).decode("ascii"),
        )

    async def sftp_mkdir(self, connection_id: str, path: str) -> None:
        await self._request("sftp_mkdir", connection_id=connection_id, path=path)

    async def sftp_rename(self, connection_id: str, old_path: str, new_path: str) -> None:
        await self._request(
            "sftp_rename",
            connection_id=connection_id,
            old_path=old_path,
            new_path=new_path,
        )

    async def sftp_remove(self, connection_id: str, path: str) -> None:
        await self._request("sftp_remove", connection_id=connection_id, path=path)

    async def sftp_chmod(self, connection_id: str, path: str, mode: int) -> None:
        await self._request(
            "sftp_chmod", connection_id=connection_id, path=path, mode=mode,
        )

    async def sftp_close(self, connection_id: str) -> None:
        await self._request("sftp_close", connection_id=connection_id)

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    async def session_has_capacity(self, user_id, max_sessions: int) -> bool:
        result = await self._request(
            "session_has_capacity", user_id=user_id, max_sessions=max_sessions,
        )
        return result.get("ok", False)

    async def session_register(
        self, user_id, tab_id: str, connection_id: str, session_type: str,
    ) -> None:
        await self._request(
            "session_register",
            user_id=user_id,
            tab_id=tab_id,
            connection_id=connection_id,
            session_type=session_type,
        )

    async def session_unregister(self, user_id, tab_id: str) -> None:
        await self._request(
            "session_unregister", user_id=user_id, tab_id=tab_id,
        )

    async def list_connections(self) -> list[str]:
        result = await self._request("list_connections")
        return result.get("connection_ids", [])


# Module-level singleton — workers import this.
ssh_proxy = SSHProxy()
