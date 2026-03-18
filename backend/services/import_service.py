"""Session import parsers for various formats."""
import configparser
import io
import logging
import re
from xml.etree.ElementTree import ParseError
from typing import Optional

from defusedxml import ElementTree as ET  # mandatory for safe XML parsing

from backend.schemas.import_session import ImportedSession

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MobaXterm session type mapping
# ---------------------------------------------------------------------------
MOBA_SESSION_TYPES = {
    "0": "ssh",
    "1": "telnet",
    "4": "rdp",
    "5": "vnc",
    "7": "sftp",
}

MOBA_DEFAULT_PORTS = {
    "ssh": 22,
    "telnet": 23,
    "rdp": 3389,
    "vnc": 5900,
    "sftp": 22,
}

# ---------------------------------------------------------------------------
# mRemoteNG protocol mapping
# ---------------------------------------------------------------------------
MREMOTENG_PROTOCOL_MAP = {
    "SSH1": "ssh",
    "SSH2": "ssh",
    "RDP": "rdp",
    "VNC": "vnc",
    "Telnet": "telnet",
    "Rlogin": "telnet",
}

MREMOTENG_DEFAULT_PORTS = {
    "ssh": 22,
    "rdp": 3389,
    "vnc": 5900,
    "telnet": 23,
}


def detect_format(filename: str, content: str) -> str:
    """Detect the import file format from filename and content.

    Returns one of: 'mobaxterm', 'ssh_config', 'mremoteng', 'putty'.
    Raises ValueError if format cannot be determined.
    """
    lower = filename.lower()

    if lower.endswith(".mxtsessions"):
        return "mobaxterm"
    if lower.endswith(".reg"):
        return "putty"
    if lower.endswith(".xml"):
        return "mremoteng"

    # Check for known file names
    if lower in ("config", "ssh_config", ".ssh_config"):
        return "ssh_config"

    # Content-based detection
    stripped = content.strip()
    if stripped.startswith("[Bookmarks"):
        return "mobaxterm"
    if stripped.startswith("Windows Registry Editor"):
        return "putty"
    if stripped.startswith("<?xml") or "<mrng:Connections" in stripped or "<Connections" in stripped:
        return "mremoteng"
    if re.search(r"^Host\s+\S+", stripped, re.MULTILINE):
        return "ssh_config"

    raise ValueError(
        "Could not detect file format. Supported formats: "
        "MobaXterm (.mxtsessions), SSH Config, mRemoteNG (.xml), PuTTY (.reg)"
    )


def parse_sessions(filename: str, content: str) -> tuple[list[ImportedSession], list[str], str]:
    """Parse sessions from an import file.

    Args:
        filename: Original filename (used for format detection).
        content: File content as a string.

    Returns:
        Tuple of (sessions, warnings, format_name).
    """
    fmt = detect_format(filename, content)

    if fmt == "mobaxterm":
        sessions, warnings = parse_mobaxterm(content)
    elif fmt == "ssh_config":
        sessions, warnings = parse_ssh_config(content)
    elif fmt == "mremoteng":
        sessions, warnings = parse_mremoteng(content)
    elif fmt == "putty":
        sessions, warnings = parse_putty_reg(content)
    else:
        raise ValueError(f"Unsupported format: {fmt}")

    return sessions, warnings, fmt


# ---------------------------------------------------------------------------
# MobaXterm .mxtsessions parser
# ---------------------------------------------------------------------------

def parse_mobaxterm(content: str) -> tuple[list[ImportedSession], list[str]]:
    """Parse MobaXterm .mxtsessions INI file.

    The file contains [Bookmarks] and [Bookmarks_N] sections.
    Each section has SubRep (folder path) and session entries as key=value
    where the value is a #-separated string with %-separated fields.
    """
    sessions: list[ImportedSession] = []
    warnings: list[str] = []

    parser = configparser.RawConfigParser()
    parser.optionxform = str  # Preserve case
    try:
        parser.read_string(content)
    except configparser.Error as e:
        warnings.append(f"Failed to parse MobaXterm file: {e}")
        return sessions, warnings

    for section in parser.sections():
        if not section.startswith("Bookmarks"):
            continue

        folder_path = parser.get(section, "SubRep", fallback="").strip()
        # Normalize backslash separators to forward slash
        if folder_path:
            folder_path = folder_path.replace("\\", "/")

        for key, value in parser.items(section):
            if key.lower() in ("subrep", "imgnum"):
                continue

            session_name = key
            try:
                session = _parse_moba_session_line(session_name, value, folder_path)
                if session:
                    sessions.append(session)
            except Exception as e:
                warnings.append(f"Skipped session '{session_name}': {e}")

    return sessions, warnings


def _parse_moba_session_line(
    name: str, value: str, folder_path: str
) -> Optional[ImportedSession]:
    """Parse a single MobaXterm session line."""
    # Value format: <reconnect>#<icon>#<group1 %-separated>#<group2>#<start>#<comment>#<color>
    parts = value.split("#")
    if len(parts) < 3:
        return None

    # Group 1 has the connection settings (%-separated)
    group1 = parts[2].split("%") if len(parts) > 2 else []
    if len(group1) < 3:
        return None

    session_type_id = group1[0] if group1 else "0"
    session_type = MOBA_SESSION_TYPES.get(session_type_id)
    if session_type is None:
        return None  # Unsupported type (serial, etc.)

    host = group1[1].strip() if len(group1) > 1 else ""
    if not host:
        return None

    port_str = group1[2].strip() if len(group1) > 2 else ""
    try:
        port = int(port_str) if port_str else MOBA_DEFAULT_PORTS.get(session_type, 22)
    except ValueError:
        port = MOBA_DEFAULT_PORTS.get(session_type, 22)

    username = group1[3].strip() if len(group1) > 3 else None
    if not username:
        username = None

    return ImportedSession(
        name=name.strip(),
        session_type=session_type,
        host=host,
        port=port,
        username=username,
        folder_path=folder_path if folder_path else None,
    )


# ---------------------------------------------------------------------------
# SSH Config parser
# ---------------------------------------------------------------------------

def parse_ssh_config(content: str) -> tuple[list[ImportedSession], list[str]]:
    """Parse OpenSSH config file format.

    Parses Host blocks with HostName, User, Port, IdentityFile directives.
    Skips wildcard Host entries (e.g., Host *).
    """
    sessions: list[ImportedSession] = []
    warnings: list[str] = []

    current_host: Optional[str] = None
    current_data: dict[str, str] = {}

    def _flush():
        nonlocal current_host, current_data
        if current_host and current_host != "*":
            hostname = current_data.get("hostname", current_host)
            if hostname and hostname != "*":
                port_str = current_data.get("port", "22")
                try:
                    port = int(port_str)
                except ValueError:
                    port = 22
                sessions.append(ImportedSession(
                    name=current_host,
                    session_type="ssh",
                    host=hostname,
                    port=port,
                    username=current_data.get("user"),
                    folder_path=None,
                ))
        current_host = None
        current_data = {}

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        # Match keyword-value pairs (space or = separated)
        match = re.match(r"^(\S+)\s*[=\s]\s*(.+)$", line)
        if not match:
            continue

        keyword = match.group(1).lower()
        value = match.group(2).strip()

        if keyword == "host":
            _flush()
            # Host can have multiple patterns; take the first non-wildcard
            hosts = value.split()
            for h in hosts:
                if "*" not in h and "?" not in h:
                    current_host = h
                    break
            if current_host is None and hosts:
                current_host = hosts[0]
        elif current_host:
            current_data[keyword] = value

    _flush()
    return sessions, warnings


# ---------------------------------------------------------------------------
# mRemoteNG XML parser
# ---------------------------------------------------------------------------

def parse_mremoteng(content: str) -> tuple[list[ImportedSession], list[str]]:
    """Parse mRemoteNG XML export file.

    mRemoteNG uses nested <Node> elements where Type="Container" represents
    folders and Type="Connection" represents sessions.
    """
    sessions: list[ImportedSession] = []
    warnings: list[str] = []

    try:
        root = ET.fromstring(content)
    except (ParseError, Exception) as e:
        warnings.append(f"Failed to parse XML: {e}")
        return sessions, warnings

    def _walk(node: ET.Element, path: str = ""):
        for child in node:
            tag = child.tag
            # Strip namespace if present
            if "}" in tag:
                tag = tag.split("}", 1)[1]

            if tag != "Node":
                continue

            node_type = child.get("Type", "")
            name = child.get("Name", "")

            if node_type == "Container":
                child_path = f"{path}/{name}" if path else name
                _walk(child, child_path)
            elif node_type == "Connection":
                protocol_str = child.get("Protocol", "")
                session_type = MREMOTENG_PROTOCOL_MAP.get(protocol_str)
                if session_type is None:
                    warnings.append(f"Skipped '{name}': unsupported protocol '{protocol_str}'")
                    continue

                hostname = child.get("Hostname", "").strip()
                if not hostname:
                    warnings.append(f"Skipped '{name}': no hostname")
                    continue

                port_str = child.get("Port", "")
                try:
                    port = int(port_str) if port_str else MREMOTENG_DEFAULT_PORTS.get(session_type, 22)
                except ValueError:
                    port = MREMOTENG_DEFAULT_PORTS.get(session_type, 22)

                username = child.get("Username", "").strip() or None

                sessions.append(ImportedSession(
                    name=name,
                    session_type=session_type,
                    host=hostname,
                    port=port,
                    username=username,
                    folder_path=path if path else None,
                ))

    _walk(root)
    return sessions, warnings


# ---------------------------------------------------------------------------
# PuTTY .reg parser
# ---------------------------------------------------------------------------

def parse_putty_reg(content: str) -> tuple[list[ImportedSession], list[str]]:
    """Parse PuTTY registry export (.reg) file.

    PuTTY sessions are stored under HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\<name>.
    Each session section contains string and DWORD values.
    """
    sessions: list[ImportedSession] = []
    warnings: list[str] = []

    # Pattern for session section header
    section_re = re.compile(
        r"^\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\(.+?)\]$",
        re.IGNORECASE,
    )

    current_name: Optional[str] = None
    current_data: dict[str, str] = {}

    def _flush():
        nonlocal current_name, current_data
        if current_name:
            hostname = current_data.get("hostname", "").strip()
            protocol = current_data.get("protocol", "ssh").lower()

            if not hostname:
                warnings.append(f"Skipped PuTTY session '{current_name}': no hostname")
            else:
                # Map PuTTY protocol names
                session_type = "ssh"
                if protocol in ("telnet",):
                    session_type = "telnet"

                port_hex = current_data.get("portnumber", "")
                try:
                    port = int(port_hex, 16) if port_hex else 22
                except ValueError:
                    port = 22

                username = current_data.get("username", "").strip() or None

                # Decode URL-encoded session name
                decoded_name = re.sub(
                    r"%([0-9A-Fa-f]{2})",
                    lambda m: chr(int(m.group(1), 16)),
                    current_name,
                )

                sessions.append(ImportedSession(
                    name=decoded_name,
                    session_type=session_type,
                    host=hostname,
                    port=port,
                    username=username,
                    folder_path=None,
                ))
        current_name = None
        current_data = {}

    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue

        section_match = section_re.match(line)
        if section_match:
            _flush()
            current_name = section_match.group(1)
            continue

        if current_name is None:
            continue

        # Parse "Key"="Value" (string)
        str_match = re.match(r'^"(.+?)"="(.+?)"$', line)
        if str_match:
            key = str_match.group(1).lower()
            current_data[key] = str_match.group(2)
            continue

        # Parse "Key"=dword:XXXXXXXX
        dword_match = re.match(r'^"(.+?)"=dword:([0-9a-fA-F]+)$', line)
        if dword_match:
            key = dword_match.group(1).lower()
            current_data[key] = dword_match.group(2)

    _flush()
    return sessions, warnings
