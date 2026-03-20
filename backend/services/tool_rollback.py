"""Rollback point capture and apply helpers for tools safety."""

import base64
import json
import logging
import shlex
from datetime import datetime, timezone

from sqlalchemy import select

from backend.database import async_session_factory
from backend.models.tool_rollback_point import ToolRollbackPoint
from backend.services.ssh_proxy import ssh_proxy

logger = logging.getLogger(__name__)


def _json_dumps(value: dict) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def _json_loads(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _safe_service_name(name: str) -> str:
    return "".join(ch for ch in name if ch.isalnum() or ch in "-_.@")[:200]


async def create_rollback_point(
    *,
    user_id: str,
    connection_id: str,
    tool: str,
    action: str,
    request_data: dict | None = None,
) -> str | None:
    """Capture a rollback snapshot for supported mutating actions."""
    if not connection_id:
        return None

    request_data = request_data or {}
    snapshot: dict = {
        "tool": tool,
        "action": action,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        if tool == "firewall":
            iptables = await ssh_proxy.run_command(
                connection_id,
                "sudo iptables-save 2>/dev/null || true",
                timeout=10,
            )
            ufw = await ssh_proxy.run_command(
                connection_id,
                "sudo ufw status numbered 2>/dev/null || true",
                timeout=10,
            )
            firewalld = await ssh_proxy.run_command(
                connection_id,
                "sudo firewall-cmd --list-all --permanent 2>/dev/null || true",
                timeout=10,
            )
            snapshot.update(
                {
                    "iptables_save": iptables.get("stdout", ""),
                    "ufw_status": ufw.get("stdout", ""),
                    "firewalld_permanent": firewalld.get("stdout", ""),
                    "supports_apply": True,
                }
            )

        elif tool == "services":
            service_name = _safe_service_name(request_data.get("service_name", ""))
            if service_name:
                state = await ssh_proxy.run_command(
                    connection_id,
                    f"systemctl is-active {service_name} 2>/dev/null || true",
                    timeout=5,
                )
                enabled = await ssh_proxy.run_command(
                    connection_id,
                    f"systemctl is-enabled {service_name} 2>/dev/null || true",
                    timeout=5,
                )
                snapshot.update(
                    {
                        "service_name": service_name,
                        "was_active": state.get("stdout", "").strip(),
                        "was_enabled": enabled.get("stdout", "").strip(),
                        "supports_apply": True,
                    }
                )
            else:
                snapshot["supports_apply"] = False

        elif tool == "docker":
            path = str(request_data.get("path", "")).strip()
            if path:
                quoted_path = shlex.quote(path)
                read = await ssh_proxy.run_command(
                    connection_id,
                    f"cat {quoted_path} 2>/dev/null || true",
                    timeout=8,
                )
                snapshot.update(
                    {
                        "path": path,
                        "previous_content": read.get("stdout", ""),
                        "supports_apply": True,
                    }
                )
            else:
                snapshot["supports_apply"] = False

        else:
            # Generic metadata-only checkpoint for unsupported tool-specific restore.
            snapshot["supports_apply"] = False
            snapshot["request"] = request_data

    except Exception as e:
        logger.warning("Rollback capture failed for %s/%s: %s", tool, action, e)
        snapshot["supports_apply"] = False
        snapshot["capture_error"] = str(e)

    row = ToolRollbackPoint(
        user_id=user_id,
        connection_id=connection_id,
        tool=tool,
        action=action,
        status="available",
        snapshot_json=_json_dumps(snapshot),
    )
    async with async_session_factory() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row.id


async def list_rollback_points(user_id: str, limit: int = 100) -> list[dict]:
    """List rollback points for a user."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(ToolRollbackPoint)
            .where(ToolRollbackPoint.user_id == user_id)
            .order_by(ToolRollbackPoint.created_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()

    return [
        {
            "id": r.id,
            "connection_id": r.connection_id,
            "tool": r.tool,
            "action": r.action,
            "status": r.status,
            "snapshot": _json_loads(r.snapshot_json),
            "notes": r.notes,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "applied_at": r.applied_at.isoformat() if r.applied_at else None,
        }
        for r in rows
    ]


async def apply_rollback_point(user_id: str, rollback_id: str) -> dict:
    """Apply a rollback point when supported."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(ToolRollbackPoint).where(
                ToolRollbackPoint.id == rollback_id,
                ToolRollbackPoint.user_id == user_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return {"ok": False, "message": "Rollback point not found"}

        snapshot = _json_loads(row.snapshot_json)
        conn_id = row.connection_id

        if row.status == "applied":
            return {"ok": True, "message": "Rollback point already applied", "id": row.id}

        if not snapshot.get("supports_apply"):
            row.status = "failed"
            row.notes = "Rollback apply not supported for this snapshot"
            row.applied_at = datetime.now(timezone.utc)
            await db.commit()
            return {"ok": False, "message": row.notes, "id": row.id}

        try:
            if row.tool == "firewall":
                iptables_save = snapshot.get("iptables_save", "")
                if not iptables_save:
                    raise RuntimeError("No iptables snapshot captured")
                encoded = base64.b64encode(iptables_save.encode("utf-8")).decode("ascii")
                cmd = (
                    "tmpfile=$(mktemp /tmp/iptables_restore_XXXXXX) && "
                    f"echo '{encoded}' | base64 -d > \"$tmpfile\" && "
                    "sudo iptables-restore < \"$tmpfile\" && rm -f \"$tmpfile\""
                )
                result = await ssh_proxy.run_command(conn_id, cmd, timeout=20)
                if result.get("error"):
                    raise RuntimeError(result.get("error"))

            elif row.tool == "services":
                service_name = _safe_service_name(snapshot.get("service_name", ""))
                if not service_name:
                    raise RuntimeError("No service name captured")
                was_active = str(snapshot.get("was_active", "")).strip()
                was_enabled = str(snapshot.get("was_enabled", "")).strip()
                cmds = []
                if was_enabled in {"enabled", "static"}:
                    cmds.append(f"sudo systemctl enable {service_name} || true")
                elif was_enabled in {"disabled", "masked"}:
                    cmds.append(f"sudo systemctl disable {service_name} || true")
                if was_active == "active":
                    cmds.append(f"sudo systemctl start {service_name} || true")
                else:
                    cmds.append(f"sudo systemctl stop {service_name} || true")
                result = await ssh_proxy.run_command(conn_id, " && ".join(cmds), timeout=20)
                if result.get("error"):
                    raise RuntimeError(result.get("error"))

            elif row.tool == "docker":
                path = str(snapshot.get("path", "")).strip()
                previous = snapshot.get("previous_content", "")
                if not path:
                    raise RuntimeError("No file path captured")
                encoded = base64.b64encode(previous.encode("utf-8")).decode("ascii")
                cmd = f"echo '{encoded}' | base64 -d > {shlex.quote(path)}"
                result = await ssh_proxy.run_command(conn_id, cmd, timeout=20)
                if result.get("error"):
                    raise RuntimeError(result.get("error"))

            else:
                raise RuntimeError("Unsupported rollback tool")

            row.status = "applied"
            row.notes = "Rollback applied"
            row.applied_at = datetime.now(timezone.utc)
            await db.commit()
            return {"ok": True, "message": "Rollback applied", "id": row.id}

        except Exception as e:
            row.status = "failed"
            row.notes = str(e)
            row.applied_at = datetime.now(timezone.utc)
            await db.commit()
            return {"ok": False, "message": str(e), "id": row.id}
