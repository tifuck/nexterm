"""IPC protocol for communication between uvicorn workers and the SSH manager process."""

import json
import os
from pathlib import Path

# Socket path — lives next to the database in the data/ directory.
_BASE_DIR = Path(__file__).resolve().parent.parent.parent
IPC_SOCKET_PATH = str(_BASE_DIR / "data" / "nexterm_ssh.sock")

# Maximum message size (16 MB — large enough for SFTP file transfers + base64 overhead).
MAX_MESSAGE_SIZE = 16 * 1024 * 1024


def encode_message(msg: dict) -> bytes:
    """Encode a dict as a length-prefixed JSON message.

    Wire format: 4-byte big-endian length prefix + UTF-8 JSON payload.
    """
    payload = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    return len(payload).to_bytes(4, "big") + payload


async def read_message(reader) -> dict | None:
    """Read a single length-prefixed JSON message from an asyncio StreamReader.

    Returns None on EOF.  Raises ``asyncio.IncompleteReadError`` if the
    connection drops mid-message.
    """
    import asyncio

    try:
        header = await reader.readexactly(4)
    except asyncio.IncompleteReadError:
        return None
    length = int.from_bytes(header, "big")
    if length > MAX_MESSAGE_SIZE:
        raise ValueError(f"Message too large: {length} bytes")
    payload = await reader.readexactly(length)
    return json.loads(payload.decode("utf-8"))


def encode_message_sync(msg: dict) -> bytes:
    """Synchronous version of encode_message (same format)."""
    return encode_message(msg)
