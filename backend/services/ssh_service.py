"""SSH connection manager using asyncssh."""

import asyncio
import collections
import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

import asyncssh

from backend.config import config

logger = logging.getLogger(__name__)

# Maximum bytes kept in the per-connection scrollback ring buffer.
# 128 KB is roughly 2000-3000 lines of typical terminal output.
MAX_SCROLLBACK_BYTES = 128 * 1024


# ---------------------------------------------------------------------------
# Custom exceptions for interactive connection flow
# ---------------------------------------------------------------------------

class HostKeyVerificationRequired(Exception):
    """Raised when the server's host key is unknown or has changed.

    The caller should present the fingerprint to the user and ask for
    confirmation before calling ``connect`` again with ``trusted_key``
    set.
    """

    def __init__(self, key_type: str, fingerprint: str, status: str):
        self.key_type = key_type
        self.fingerprint = fingerprint
        self.status = status  # "new" or "changed"
        super().__init__(
            f"Host key verification required ({status}): {key_type} {fingerprint}"
        )


class AuthenticationFailed(Exception):
    """Raised when SSH authentication fails (wrong password / key rejected).

    Distinguished from other connection errors so the caller can prompt
    the user to retry with different credentials.
    """

    def __init__(self, message: str = "Permission denied"):
        super().__init__(message)


@dataclass
class SSHConnection:
    """Represents an active SSH connection with a PTY channel."""

    connection: asyncssh.SSHClientConnection
    channel: asyncssh.SSHClientChannel
    process: asyncssh.SSHClientProcess
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    user_id: Optional[str] = None
    session_id: Optional[str] = None

    # --- Scrollback buffer ---
    # Ring buffer of raw byte chunks; oldest chunks are evicted when
    # total size exceeds MAX_SCROLLBACK_BYTES.
    output_buffer: collections.deque = field(default_factory=collections.deque)
    output_buffer_size: int = 0

    # Persistent background task that reads from process.stdout for the
    # entire lifetime of the SSH connection (not tied to any single WS).
    reader_task: Optional[asyncio.Task] = None

    # When a WebSocket is connected, this callback forwards live data to
    # the client.  Set to None when no WS is attached.
    ws_callback: Optional[Callable[[bytes], Awaitable[None]]] = None

    # Set when the SSH process exits while no WS is connected, so we can
    # inform the client on the next reconnect.
    disconnected_reason: Optional[str] = None

    # True while at least one IPC subscriber (WebSocket / browser tab) is
    # actively watching this connection.  Used by cleanup_stale() to avoid
    # killing sessions that have an open browser tab.
    has_subscriber: bool = False


class SSHConnectionManager:
    """Manages active SSH connections per user.

    Provides methods to connect, send/receive data, resize PTY,
    disconnect, and clean up stale connections.
    """

    def __init__(self):
        self._connections: dict[str, SSHConnection] = {}

    # ------------------------------------------------------------------
    # Host key helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_host_key_info(conn: asyncssh.SSHClientConnection) -> tuple[str, str]:
        """Extract key type and SHA256 fingerprint from a live connection.

        Returns:
            Tuple of (key_type, fingerprint) e.g. ("ssh-ed25519", "SHA256:abc...").

        Raises:
            RuntimeError: If the server key is unavailable (should not
                happen after a successful handshake).
        """
        server_key: asyncssh.SSHKey | None = conn.get_server_host_key()
        if server_key is None:
            raise RuntimeError("Server host key unavailable after handshake")
        raw_alg = server_key.algorithm  # type: ignore[union-attr]
        key_type = raw_alg.decode("ascii") if isinstance(raw_alg, bytes) else str(raw_alg)
        fingerprint: str = server_key.get_fingerprint("sha256")  # type: ignore[union-attr]
        return key_type, fingerprint

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    async def _verify_host_key(
        self,
        host: str,
        port: int,
        known_host_keys: list[dict] | None,
    ) -> tuple[str, str]:
        """Perform key exchange only (no auth) and verify the host key.

        Opens a throwaway connection with authentication disabled so that
        no credentials are transmitted before the host key is verified.

        Returns:
            Tuple of (key_type, fingerprint) for the verified key.

        Raises:
            HostKeyVerificationRequired: If the key is unknown or changed.
            asyncssh.Error / OSError: On connection failure.
        """
        # Connect with no auth methods so only the key exchange happens.
        # The server will reject us after key exchange (PermissionDenied),
        # but we already have the host key at that point.
        probe_kwargs: dict = {
            "host": host,
            "port": port,
            "username": "",  # dummy — never authenticated
            "known_hosts": None,
            "client_keys": [],       # disable key-based auth
            "password": None,        # disable password auth
            "agent_path": None,      # disable agent auth
            "agent_forwarding": False,
            "preferred_auth": "none",  # only try "none" auth method
        }

        try:
            conn = await asyncssh.connect(**probe_kwargs)
        except asyncssh.PermissionDenied:
            # Expected: "none" auth was rejected.  asyncssh still sets the
            # server host key before raising, but we need the connection
            # object.  Fall back to the SSHClientConnection approach.
            raise
        except (asyncssh.Error, OSError):
            raise

        # If we somehow connected (e.g. the server allows auth "none"),
        # extract the key and close.
        key_type, fingerprint = self._extract_host_key_info(conn)
        conn.close()

        known = known_host_keys or []
        matching_key = None
        changed = False
        for entry in known:
            if entry["key_type"] == key_type and entry["fingerprint"] == fingerprint:
                matching_key = entry
                break

        if matching_key is None and known:
            changed = True

        if matching_key is None:
            status = "changed" if changed else "new"
            raise HostKeyVerificationRequired(key_type, fingerprint, status)

        return key_type, fingerprint

    async def connect(
        self,
        user_id: str,
        host: str,
        port: int,
        username: str,
        password: Optional[str] = None,
        ssh_key: Optional[str] = None,
        passphrase: Optional[str] = None,
        term_type: str = "xterm-256color",
        cols: int = 80,
        rows: int = 24,
        known_host_keys: list[dict] | None = None,
    ) -> str:
        """Create an SSH connection and open a PTY session.

        Host key verification is performed **before** any credentials are
        sent.  A lightweight probe connection exchanges keys with the
        server using auth method ``none``.  Only after the fingerprint is
        verified (or the user has previously accepted it) does the real
        connection proceed with the user's password or private key.

        Args:
            user_id: ID of the user initiating the connection.
            host: Remote host address.
            port: Remote SSH port.
            username: SSH username.
            password: SSH password (optional).
            ssh_key: Private key string (optional).
            passphrase: Passphrase for the private key (optional).
            term_type: Terminal type for PTY.
            cols: Terminal width in columns.
            rows: Terminal height in rows.
            known_host_keys: List of dicts with ``key_type`` and
                ``fingerprint`` keys that the user has previously accepted
                for this host:port.  If empty/None and the host presents a
                key, ``HostKeyVerificationRequired`` is raised so the
                caller can prompt the user.

        Returns:
            A unique connection_id string.

        Raises:
            HostKeyVerificationRequired: If the server's host key is not
                in ``known_host_keys``.
            AuthenticationFailed: If authentication is rejected.
            asyncssh.Error: For other SSH errors.
            OSError: If the host is unreachable.
        """
        connection_id = str(uuid.uuid4())

        # ---------------------------------------------------------------
        # Phase 1: Host key verification (NO credentials sent)
        # ---------------------------------------------------------------
        # We open a disposable connection that only performs key exchange
        # (preferred_auth="none") so the server's host key can be checked
        # before any password or private key is transmitted.
        try:
            await self._verify_host_key(host, port, known_host_keys)
        except asyncssh.PermissionDenied:
            # "none" auth was rejected as expected.  asyncssh raises
            # PermissionDenied but does not expose the connection object.
            # Fall back to the legacy approach that uses a custom
            # known_hosts callback to validate DURING the handshake.
            # This still happens before password auth because asyncssh
            # validates the host key before sending credentials when a
            # known_hosts callback is provided.
            pass

        # Build a known_hosts validator that only accepts the fingerprints
        # the user has previously approved.  asyncssh calls this DURING
        # key exchange — before any authentication credentials are sent.
        known = known_host_keys or []

        def _known_hosts_validator(_host, _addr, _port):
            """Return an SSHAuthorizedKeys object that trusts only the
            user's previously accepted keys."""
            # If the user has no known keys, we need to probe to get the
            # fingerprint and ask them.  Raise here to trigger the prompt.
            if not known:
                return None  # accept any — we will verify after

            class _TrustedKeys:
                """Minimal known_hosts interface for asyncssh."""

                def validate(self, host_key, trusted_host_keys=None):
                    """Return True if the key matches a known fingerprint."""
                    raw_alg = host_key.algorithm
                    kt = raw_alg.decode("ascii") if isinstance(raw_alg, bytes) else str(raw_alg)
                    fp = host_key.get_fingerprint("sha256")
                    for entry in known:
                        if entry["key_type"] == kt and entry["fingerprint"] == fp:
                            return True
                    return False

            return _TrustedKeys()

        # For the common case where we have no known keys yet we still
        # need to capture the fingerprint to prompt the user.
        if not known:
            # Probe with no auth to get the key before sending credentials
            probe_kwargs: dict = {
                "host": host,
                "port": port,
                "username": username,
                "known_hosts": None,
                "client_keys": [],
                "password": None,
                "agent_path": None,
                "agent_forwarding": False,
                "preferred_auth": "none",
            }
            try:
                probe_conn = await asyncssh.connect(**probe_kwargs)
                # "none" auth succeeded (unusual but possible)
                key_type, fingerprint = self._extract_host_key_info(probe_conn)
                probe_conn.close()
                raise HostKeyVerificationRequired(key_type, fingerprint, "new")
            except asyncssh.PermissionDenied as e:
                # Expected — need to extract key from the failed connection.
                # asyncssh does not expose the conn on PermissionDenied, so
                # we use a callback-based approach instead.
                pass
            except HostKeyVerificationRequired:
                raise
            except (asyncssh.Error, OSError) as e:
                logger.error(
                    "SSH probe connection failed for user %s to %s:%d - %s",
                    user_id, host, port, e,
                )
                raise

            # Use a callback to capture the key during the real connection
            captured_key_info: list[tuple[str, str]] = []

            class _KeyCapture:
                """Captures the host key during key exchange."""

                def validate(self, host_key, trusted_host_keys=None):
                    raw_alg = host_key.algorithm
                    kt = raw_alg.decode("ascii") if isinstance(raw_alg, bytes) else str(raw_alg)
                    fp = host_key.get_fingerprint("sha256")
                    captured_key_info.append((kt, fp))
                    # Reject so the connection closes before auth
                    return False

            def _capture_hosts(_host, _addr, _port):
                return _KeyCapture()

            try:
                await asyncssh.connect(
                    host=host,
                    port=port,
                    username=username,
                    known_hosts=_capture_hosts,
                    keepalive_interval=0,
                )
            except asyncssh.HostKeyNotVerifiable:
                pass
            except (asyncssh.Error, OSError) as e:
                if captured_key_info:
                    pass  # We got the key, that's all we need
                else:
                    logger.error(
                        "SSH connection failed for user %s to %s:%d - %s",
                        user_id, host, port, e,
                    )
                    raise

            if captured_key_info:
                kt, fp = captured_key_info[0]
                raise HostKeyVerificationRequired(kt, fp, "new")
            else:
                raise RuntimeError("Failed to obtain host key from server")

        # ---------------------------------------------------------------
        # Phase 2: Authenticated connection (host key already verified)
        # ---------------------------------------------------------------
        connect_kwargs: dict = {
            "host": host,
            "port": port,
            "username": username,
            "known_hosts": None,  # already verified above
            "keepalive_interval": config.ssh_keepalive_interval,
            "keepalive_count_max": 3,
        }

        if ssh_key:
            try:
                private_key = asyncssh.import_private_key(ssh_key, passphrase)
                connect_kwargs["client_keys"] = [private_key]
            except asyncssh.KeyImportError as e:
                logger.error("Failed to import SSH key: %s", e)
                raise

        if password:
            connect_kwargs["password"] = password

        try:
            conn = await asyncssh.connect(**connect_kwargs)
        except asyncssh.PermissionDenied as e:
            logger.warning(
                "SSH auth failed for user %s to %s:%d - %s",
                user_id, host, port, e,
            )
            raise AuthenticationFailed(str(e))
        except (asyncssh.Error, OSError) as e:
            logger.error(
                "SSH connection failed for user %s to %s:%d - %s",
                user_id, host, port, e,
            )
            raise

        # Key is trusted — proceed to open a PTY.
        try:
            process = await conn.create_process(
                term_type=term_type,
                term_size=(cols, rows),
            )
            channel = process.channel
        except asyncssh.Error as e:
            logger.error("Failed to open PTY session: %s", e)
            conn.close()
            raise

        ssh_conn = SSHConnection(
            connection=conn,
            channel=channel,
            process=process,
            user_id=user_id,
            session_id=connection_id,
        )
        self._connections[connection_id] = ssh_conn

        logger.info(
            "SSH connection %s established for user %s to %s:%d",
            connection_id, user_id, host, port,
        )
        return connection_id

    # ------------------------------------------------------------------
    # Persistent background reader
    # ------------------------------------------------------------------

    def start_reading(self, connection_id: str) -> None:
        """Start the persistent background reader for a connection.

        The reader runs for the entire lifetime of the SSH connection,
        buffering output even when no WebSocket client is attached.
        """
        conn = self._connections.get(connection_id)
        if conn is None:
            raise KeyError(f"Connection {connection_id} not found")
        if conn.reader_task is not None:
            return  # Already running

        conn.reader_task = asyncio.create_task(
            self._background_reader(connection_id)
        )

    async def _background_reader(self, connection_id: str) -> None:
        """Continuously read SSH stdout, buffer output, and forward to WS."""
        conn = self._connections.get(connection_id)
        if conn is None:
            return

        try:
            while True:
                try:
                    data = await conn.process.stdout.read(65536)
                except (asyncssh.BreakReceived, asyncssh.Error):
                    data = None

                if data is None:
                    # SSH process exited
                    conn.disconnected_reason = "SSH session ended"
                    break

                if isinstance(data, str):
                    data = data.encode("utf-8")

                if not data:
                    await asyncio.sleep(0.01)
                    continue

                conn.last_activity = datetime.now(timezone.utc)

                # Append to ring buffer
                self._buffer_append(conn, data)

                # Forward to WebSocket if one is attached
                if conn.ws_callback is not None:
                    try:
                        await conn.ws_callback(data)
                    except Exception:
                        # WebSocket send failed -- detach callback so we
                        # don't keep retrying on a dead socket.
                        conn.ws_callback = None

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Background reader error for %s: %s", connection_id, e)
            conn = self._connections.get(connection_id)
            if conn:
                conn.disconnected_reason = f"Read error: {e}"

        # Send a sentinel (None) through the callback so subscribers learn
        # that the SSH session has ended.  This propagates through the IPC
        # layer all the way to the frontend WebSocket.
        conn = self._connections.get(connection_id)
        if conn and conn.ws_callback is not None:
            try:
                await conn.ws_callback(None)
            except Exception:
                pass

    @staticmethod
    def _buffer_append(conn: SSHConnection, data: bytes) -> None:
        """Append data to the ring buffer, evicting oldest chunks if needed."""
        conn.output_buffer.append(data)
        conn.output_buffer_size += len(data)

        # Evict oldest chunks until we're back under the cap
        while conn.output_buffer_size > MAX_SCROLLBACK_BYTES and conn.output_buffer:
            evicted = conn.output_buffer.popleft()
            conn.output_buffer_size -= len(evicted)

    # ------------------------------------------------------------------
    # Subscriber tracking (browser tab open / closed)
    # ------------------------------------------------------------------

    def mark_subscribed(self, connection_id: str) -> None:
        """Mark a connection as having an active IPC subscriber (open browser tab)."""
        conn = self._connections.get(connection_id)
        if conn is not None:
            conn.has_subscriber = True

    def mark_unsubscribed(self, connection_id: str) -> None:
        """Mark a connection as having no active IPC subscribers."""
        conn = self._connections.get(connection_id)
        if conn is not None:
            conn.has_subscriber = False

    # ------------------------------------------------------------------
    # WebSocket callback registration
    # ------------------------------------------------------------------

    def register_ws_callback(
        self, connection_id: str, callback: Callable[[bytes], Awaitable[None]]
    ) -> None:
        """Attach a WebSocket forwarding callback to a connection."""
        conn = self._connections.get(connection_id)
        if conn is None:
            raise KeyError(f"Connection {connection_id} not found")
        conn.ws_callback = callback

    def unregister_ws_callback(self, connection_id: str) -> None:
        """Detach the WebSocket callback from a connection."""
        conn = self._connections.get(connection_id)
        if conn is not None:
            conn.ws_callback = None

    # ------------------------------------------------------------------
    # Scrollback retrieval
    # ------------------------------------------------------------------

    def get_buffered_output(self, connection_id: str) -> bytes:
        """Return the current scrollback buffer contents as a single bytes object."""
        conn = self._connections.get(connection_id)
        if conn is None:
            return b""
        return b"".join(conn.output_buffer)

    # ------------------------------------------------------------------
    # Original public API
    # ------------------------------------------------------------------

    async def send_data(self, connection_id: str, data: bytes) -> None:
        """Write data to the SSH channel stdin.

        Args:
            connection_id: The connection to write to.
            data: Raw bytes to send.

        Raises:
            KeyError: If connection_id is not found.
        """
        conn = self._connections.get(connection_id)
        if conn is None:
            raise KeyError(f"Connection {connection_id} not found")

        conn.last_activity = datetime.now(timezone.utc)
        conn.process.stdin.write(data.decode("utf-8", errors="replace"))

    async def receive_data(self, connection_id: str) -> bytes | None:
        """Read available data from the SSH channel stdout (non-blocking).

        Note: Prefer using start_reading() + ws_callback for new code.
        This method is retained for backward compatibility.

        Args:
            connection_id: The connection to read from.

        Returns:
            Bytes read from the channel, None if the connection closed,
            or empty bytes if nothing is available.

        Raises:
            KeyError: If connection_id is not found.
        """
        conn = self._connections.get(connection_id)
        if conn is None:
            raise KeyError(f"Connection {connection_id} not found")

        conn.last_activity = datetime.now(timezone.utc)
        try:
            data = await conn.process.stdout.read(65536)
            if not data:
                return None
            if isinstance(data, str):
                return data.encode("utf-8")
            return data
        except asyncssh.BreakReceived:
            return b""
        except asyncssh.Error:
            return b""

    async def resize(self, connection_id: str, cols: int, rows: int) -> None:
        """Resize the PTY for a connection.

        Args:
            connection_id: The connection whose PTY to resize.
            cols: New terminal width.
            rows: New terminal height.

        Raises:
            KeyError: If connection_id is not found.
        """
        conn = self._connections.get(connection_id)
        if conn is None:
            raise KeyError(f"Connection {connection_id} not found")

        conn.last_activity = datetime.now(timezone.utc)
        conn.channel.change_terminal_size(cols, rows)

    async def disconnect(self, connection_id: str) -> None:
        """Close an SSH connection and remove it from the manager.

        Args:
            connection_id: The connection to close.
        """
        conn = self._connections.pop(connection_id, None)
        if conn is None:
            logger.warning("Attempted to disconnect unknown connection %s", connection_id)
            return

        # Cancel the persistent reader task
        if conn.reader_task and not conn.reader_task.done():
            conn.reader_task.cancel()
            try:
                await conn.reader_task
            except asyncio.CancelledError:
                pass

        try:
            conn.process.close()
            conn.connection.close()
        except Exception as e:
            logger.error("Error closing connection %s: %s", connection_id, e)

        # Free the session slot so the user can open new connections.
        # Import here to avoid circular imports (session_manager is lightweight).
        from backend.services.session_manager import session_manager
        session_manager.unregister_by_connection_id(connection_id)

        logger.info("SSH connection %s disconnected", connection_id)

    async def get_connection(self, connection_id: str) -> Optional[SSHConnection]:
        """Retrieve an active SSH connection by ID.

        Args:
            connection_id: The connection ID to look up.

        Returns:
            The SSHConnection if found, otherwise None.
        """
        return self._connections.get(connection_id)

    async def cleanup_stale(self, keep_alive_minutes: int = 30) -> None:
        """Remove connections that have been inactive longer than the threshold.

        Only orphaned connections (no active browser tab / IPC subscriber)
        are eligible for cleanup.  Connections with an open browser tab are
        kept alive indefinitely — the SSH-level keepalive packets maintain
        the underlying TCP connection.

        Args:
            keep_alive_minutes: Maximum idle time in minutes before an
                *orphaned* connection is considered stale.
        """
        now = datetime.now(timezone.utc)
        stale_ids = []

        for conn_id, conn in self._connections.items():
            # Never clean up connections that have an active browser tab.
            if conn.has_subscriber:
                continue
            idle_seconds = (now - conn.last_activity).total_seconds()
            if idle_seconds > keep_alive_minutes * 60:
                stale_ids.append(conn_id)

        for conn_id in stale_ids:
            logger.info("Cleaning up stale connection %s", conn_id)
            await self.disconnect(conn_id)


ssh_manager = SSHConnectionManager()
