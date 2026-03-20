"""RBAC and action policy resolution for server tools."""

from dataclasses import dataclass

from backend.config import config


TOOL_ROLES = ("user",)


@dataclass(slots=True)
class ResolvedToolAction:
    """Resolved policy metadata for an incoming tools action."""

    tool: str
    action: str
    method: str
    path: str
    connection_id: str | None
    is_mutation: bool
    risk_level: str


def normalize_role(role: str | None) -> str:
    """Normalize unknown or missing role values."""
    _ = role
    return "user"


def _risk_from_path(method: str, path_tail: str) -> str:
    """Classify action risk level by method/path heuristics."""
    if method == "GET":
        return "low"

    high_keywords = (
        "kill",
        "delete",
        "remove",
        "reset",
        "uninstall",
        "purge",
        "defaults",
        "policy",
        "format",
        "wipe",
        "destroy",
    )
    medium_keywords = (
        "restart",
        "reload",
        "toggle",
        "add",
        "update",
        "save",
        "action",
        "run",
        "pull",
        "install",
    )

    lower = path_tail.lower()
    if any(k in lower for k in high_keywords):
        return "high"
    if any(k in lower for k in medium_keywords):
        return "medium"
    if method in {"DELETE", "PUT"}:
        return "high"
    return "medium"


def resolve_http_tool_action(method: str, path: str) -> ResolvedToolAction | None:
    """Resolve tool/action metadata from an /api/tools HTTP request."""
    if not path.startswith("/api/tools"):
        return None

    method_u = method.upper()
    is_mutation = method_u in {"POST", "PUT", "PATCH", "DELETE"}
    segments = [s for s in path.split("/") if s]

    # /api/tools
    if len(segments) <= 2:
        return ResolvedToolAction(
            tool="tools",
            action="root",
            method=method_u,
            path=path,
            connection_id=None,
            is_mutation=is_mutation,
            risk_level="low",
        )

    # /api/tools/jobs..., /api/tools/audit..., /api/tools/capabilities...
    top = segments[2]
    if top in {"jobs", "audit", "capabilities", "rollback-points", "safety"}:
        tail = "/".join(segments[3:]) or "root"
        return ResolvedToolAction(
            tool=top,
            action=f"{method_u.lower()}:{tail}",
            method=method_u,
            path=path,
            connection_id=None,
            is_mutation=is_mutation,
            risk_level=_risk_from_path(method_u, tail),
        )

    connection_id = top
    tail_segments = segments[3:]
    if not tail_segments:
        tool = "tools"
        tail = "root"
    else:
        raw_tool = tail_segments[0]
        tool_aliases = {
            "system-info": "system",
            "security-scan": "security",
            "malware-scan": "security",
        }
        tool = tool_aliases.get(raw_tool, raw_tool)
        tail = "/".join(tail_segments)

    return ResolvedToolAction(
        tool=tool,
        action=f"{method_u.lower()}:{tail}",
        method=method_u,
        path=path,
        connection_id=connection_id,
        is_mutation=is_mutation,
        risk_level=_risk_from_path(method_u, tail),
    )


def resolve_ws_tool_action(message_type: str) -> ResolvedToolAction | None:
    """Resolve policy metadata from /ws/tools message type."""
    mt = (message_type or "").strip()
    ws_map: dict[str, tuple[str, str, bool, str]] = {
        "subscribe_dashboard": ("system", "subscribe_dashboard", False, "low"),
        "unsubscribe_dashboard": ("system", "unsubscribe_dashboard", False, "low"),
        "start_log_tail": ("logs", "start_log_tail", False, "low"),
        "stop_log_tail": ("logs", "stop_log_tail", False, "low"),
        "wireguard_install": ("wireguard", "install", True, "high"),
        "wireguard_install_kill": ("wireguard", "cancel_install", True, "medium"),
        "docker_install": ("docker", "install", True, "high"),
        "docker_install_kill": ("docker", "cancel_install", True, "medium"),
        "docker_logs_stream": ("docker", "stream_logs", False, "low"),
        "docker_logs_stop": ("docker", "stop_logs", False, "low"),
        "docker_pull_image": ("docker", "pull_image", True, "medium"),
        "docker_pull_stop": ("docker", "cancel_pull", True, "medium"),
        "ping": ("tools", "ping", False, "low"),
    }
    if mt not in ws_map:
        return None
    tool, action, is_mutation, risk = ws_map[mt]
    return ResolvedToolAction(
        tool=tool,
        action=action,
        method="WS",
        path=f"/ws/tools:{mt}",
        connection_id=None,
        is_mutation=is_mutation,
        risk_level=risk,
    )


def is_action_allowed(role: str | None, resolved: ResolvedToolAction) -> bool:
    """Return True when server policy allows the resolved action."""
    _ = role
    if not config.tools_enabled:
        return False
    if not resolved.is_mutation:
        return True
    if not config.tools_mutations_enabled:
        return False
    if resolved.risk_level == "high" and not config.tools_high_risk_enabled:
        return False
    return True


def build_tool_capabilities(role: str | None) -> dict:
    """Return a config-derived capabilities map for the tools panel."""
    _ = role
    tools = [
        "system",
        "processes",
        "services",
        "logs",
        "scripts",
        "security",
        "firewall",
        "packages",
        "docker",
        "wireguard",
        "cron",
        "jobs",
        "audit",
    ]
    caps: dict[str, dict[str, bool]] = {}
    can_read = config.tools_enabled
    can_execute = config.tools_enabled and config.tools_mutations_enabled
    can_high_risk = can_execute and config.tools_high_risk_enabled
    for tool in tools:
        caps[tool] = {
            "read": can_read,
            "execute": can_execute,
            "high_risk": can_high_risk,
        }
    return {
        "role": "user",
        "tools": caps,
    }
