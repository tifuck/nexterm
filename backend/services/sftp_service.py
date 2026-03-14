"""SFTP operations service using asyncssh."""

import asyncio
import logging
import stat as stat_module
from datetime import datetime, timezone
from typing import Any, Optional

import asyncssh

logger = logging.getLogger(__name__)

DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class SFTPService:
    """Manages SFTP sessions and provides file operation methods."""

    def __init__(self):
        self._connections: dict[str, asyncssh.SFTPClient] = {}

    async def get_sftp_client(
        self,
        connection_id: str,
        ssh_connection: asyncssh.SSHClientConnection,
    ) -> asyncssh.SFTPClient:
        """Open an SFTP subsystem on an existing SSH connection.

        If an SFTP client already exists for the connection_id, it is returned.

        Args:
            connection_id: Unique identifier for this SFTP session.
            ssh_connection: The underlying asyncssh SSH connection.

        Returns:
            An asyncssh SFTPClient instance.
        """
        if connection_id in self._connections:
            return self._connections[connection_id]

        sftp_client = await ssh_connection.start_sftp_client()
        self._connections[connection_id] = sftp_client
        logger.info("SFTP client opened for connection %s", connection_id)
        return sftp_client

    def _get_client(self, connection_id: str) -> asyncssh.SFTPClient:
        """Retrieve an existing SFTP client by connection ID.

        Raises:
            KeyError: If no SFTP client exists for the given connection_id.
        """
        client = self._connections.get(connection_id)
        if client is None:
            raise KeyError(f"No SFTP client for connection {connection_id}")
        return client

    async def get_home_directory(self, connection_id: str) -> str:
        """Get the home/starting directory for this SFTP session.

        Uses realpath('.') which resolves to the default directory the SFTP
        session started in (typically the user's home directory).

        Args:
            connection_id: The SFTP session identifier.

        Returns:
            The absolute path to the home directory.
        """
        client = self._get_client(connection_id)
        home = await client.realpath('.')
        return str(home)

    async def list_directory(self, connection_id: str, path: str) -> list[dict[str, Any]]:
        """List the contents of a remote directory.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote directory path.

        Returns:
            A list of dicts, each containing: name, size, permissions,
            modified, is_dir, is_link.
        """
        client = self._get_client(connection_id)
        entries = []

        async for entry in client.scandir(path):
            # Skip . and .. entries
            if entry.filename in ('.', '..'):
                continue

            attrs = entry.attrs
            mode = attrs.permissions if attrs.permissions is not None else 0
            mtime = attrs.mtime
            modified = (
                datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
                if mtime is not None
                else None
            )

            entries.append({
                "name": entry.filename,
                "size": attrs.size or 0,
                "permissions": oct(mode) if mode else "0o000",
                "modified": modified,
                "is_dir": stat_module.S_ISDIR(mode) if mode else False,
                "is_link": stat_module.S_ISLNK(mode) if mode else False,
            })

        return entries

    async def read_file(
        self,
        connection_id: str,
        path: str,
        max_size: int = DEFAULT_MAX_FILE_SIZE,
    ) -> bytes:
        """Read the content of a remote file.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote file path.
            max_size: Maximum file size in bytes (default 10 MB).

        Returns:
            The file contents as bytes.

        Raises:
            ValueError: If the file exceeds max_size.
        """
        client = self._get_client(connection_id)

        file_attrs = await client.stat(path)
        if file_attrs.size is not None and file_attrs.size > max_size:
            raise ValueError(
                f"File size {file_attrs.size} exceeds maximum allowed "
                f"size of {max_size} bytes"
            )

        data = await client.open(path, "rb")
        try:
            content = await data.read(max_size + 1)
        finally:
            data.close()

        if len(content) > max_size:
            raise ValueError(
                f"File content exceeds maximum allowed size of {max_size} bytes"
            )

        return content

    async def write_file(self, connection_id: str, path: str, content: bytes) -> None:
        """Write content to a remote file.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote file path.
            content: Bytes to write.
        """
        client = self._get_client(connection_id)

        async with client.open(path, "wb") as f:
            await f.write(content)

        logger.info("Wrote %d bytes to %s", len(content), path)

    async def mkdir(self, connection_id: str, path: str) -> None:
        """Create a remote directory.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote directory path to create.
        """
        client = self._get_client(connection_id)
        await client.mkdir(path)
        logger.info("Created directory %s", path)

    async def rename(self, connection_id: str, old_path: str, new_path: str) -> None:
        """Rename or move a remote file or directory.

        Args:
            connection_id: The SFTP session identifier.
            old_path: Current path.
            new_path: New path.
        """
        client = self._get_client(connection_id)
        await client.rename(old_path, new_path)
        logger.info("Renamed %s -> %s", old_path, new_path)

    async def remove(self, connection_id: str, path: str) -> None:
        """Remove a remote file or empty directory.

        Attempts to remove as a file first; if that fails, tries rmdir.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote path to remove.
        """
        client = self._get_client(connection_id)

        try:
            await client.remove(path)
            logger.info("Removed file %s", path)
        except asyncssh.SFTPError:
            await client.rmdir(path)
            logger.info("Removed directory %s", path)

    async def stat(self, connection_id: str, path: str) -> dict[str, Any]:
        """Get file information for a remote path.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote path to stat.

        Returns:
            A dict with: name, size, permissions, modified, is_dir, is_link.
        """
        client = self._get_client(connection_id)
        attrs = await client.stat(path)

        mode = attrs.permissions if attrs.permissions is not None else 0
        mtime = attrs.mtime
        modified = (
            datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
            if mtime is not None
            else None
        )

        # Extract the file/dir name from the path
        name = path.rstrip("/").rsplit("/", 1)[-1] if "/" in path else path

        return {
            "name": name,
            "size": attrs.size or 0,
            "permissions": oct(mode) if mode else "0o000",
            "modified": modified,
            "is_dir": stat_module.S_ISDIR(mode) if mode else False,
            "is_link": stat_module.S_ISLNK(mode) if mode else False,
        }

    async def chmod(self, connection_id: str, path: str, mode: int) -> None:
        """Change file permissions on a remote path.

        Args:
            connection_id: The SFTP session identifier.
            path: Remote path.
            mode: New permissions as an integer (e.g. 0o755).
        """
        client = self._get_client(connection_id)
        await client.chmod(path, mode)
        logger.info("Changed permissions on %s to %s", path, oct(mode))

    async def close(self, connection_id: str) -> None:
        """Close and remove an SFTP client session.

        Args:
            connection_id: The SFTP session to close.
        """
        client = self._connections.pop(connection_id, None)
        if client is not None:
            client.exit()
            logger.info("SFTP client closed for connection %s", connection_id)


sftp_manager = SFTPService()
