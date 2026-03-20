"""Immutable audit logging helpers for server tools."""

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select

from backend.database import async_session_factory
from backend.models.tool_audit_log import ToolAuditLog


def _json_dumps(value: dict | list | None) -> str:
    """Stable JSON serialization used for hashing and persistence."""
    if value is None:
        return ""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def hash_request_payload(body_bytes: bytes | None) -> str:
    """Hash request payload bytes for immutable audit metadata."""
    if not body_bytes:
        return ""
    return hashlib.sha256(body_bytes).hexdigest()


async def record_tool_audit(
    *,
    user_id: str | None,
    username: str,
    user_role: str,
    method: str,
    path: str,
    tool: str,
    action: str,
    connection_id: str | None,
    status_code: int,
    outcome: str,
    dry_run: bool,
    request_hash: str = "",
    details: dict | None = None,
    job_id: str | None = None,
) -> str:
    """Append one immutable audit record and return its hash."""
    details_json = _json_dumps(details)
    created_at = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        prev = await db.execute(
            select(ToolAuditLog.record_hash).order_by(ToolAuditLog.created_at.desc()).limit(1)
        )
        prev_hash = prev.scalar_one_or_none() or ""

        digest_payload = {
            "user_id": user_id or "",
            "username": username,
            "user_role": user_role,
            "method": method,
            "path": path,
            "tool": tool,
            "action": action,
            "connection_id": connection_id or "",
            "status_code": status_code,
            "outcome": outcome,
            "dry_run": bool(dry_run),
            "job_id": job_id or "",
            "request_hash": request_hash,
            "details": details_json,
            "created_at": created_at.isoformat(),
        }
        payload_str = _json_dumps(digest_payload)
        record_hash = hashlib.sha256(f"{prev_hash}|{payload_str}".encode("utf-8")).hexdigest()

        row = ToolAuditLog(
            user_id=user_id,
            username=username,
            user_role=user_role,
            method=method,
            path=path,
            tool=tool,
            action=action,
            connection_id=connection_id,
            status_code=status_code,
            outcome=outcome,
            dry_run=1 if dry_run else 0,
            job_id=job_id,
            details_json=details_json or None,
            request_hash=request_hash,
            prev_hash=prev_hash,
            record_hash=record_hash,
            created_at=created_at,
        )
        db.add(row)
        await db.commit()

    return record_hash
