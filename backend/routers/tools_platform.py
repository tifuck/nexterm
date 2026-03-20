"""Platform-level APIs for tools jobs, audit logs, rollback, and capabilities."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from backend.config import config
from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.tool_audit_log import ToolAuditLog
from backend.models.user import User
from backend.services.tool_jobs import (
    cancel_job,
    clone_job_for_retry,
    get_job_events_for_user,
    get_job_for_user,
    list_jobs_for_user,
    mark_job_resumed,
)
from backend.services.tool_permissions import build_tool_capabilities
from backend.services.tool_rollback import apply_rollback_point, list_rollback_points

router = APIRouter(prefix="/api/tools", tags=["tools-platform"])


@router.get("/capabilities")
async def get_tools_capabilities(current_user: User = Depends(get_current_user)):
    """Return role-derived capabilities for all tools."""
    caps = build_tool_capabilities(getattr(current_user, "role", None))
    return {
        "user_id": str(current_user.id),
        "username": current_user.username,
        **caps,
    }


@router.get("/jobs")
async def list_jobs(
    status: str | None = Query(default=None),
    tool: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
):
    """List jobs for the current user."""
    jobs = await list_jobs_for_user(
        str(current_user.id),
        status=status,
        tool=tool,
        limit=limit,
    )
    return {
        "jobs": jobs,
        "total": len(jobs),
    }


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user: User = Depends(get_current_user)):
    """Get one job by id."""
    job = await get_job_for_user(str(current_user.id), job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/events")
async def get_job_events(
    job_id: str,
    limit: int = Query(default=500, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
):
    """Get append-only events for one job."""
    events = await get_job_events_for_user(str(current_user.id), job_id, limit=limit)
    return {
        "events": events,
        "total": len(events),
    }


@router.post("/jobs/{job_id}/cancel")
async def cancel_job_endpoint(job_id: str, current_user: User = Depends(get_current_user)):
    """Cancel a running/queued job."""
    job = await get_job_for_user(str(current_user.id), job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await cancel_job(job_id, message="Cancelled from jobs API")
    updated = await get_job_for_user(str(current_user.id), job_id)
    return {
        "ok": True,
        "job": updated,
    }


@router.post("/jobs/{job_id}/retry")
async def retry_job_endpoint(job_id: str, current_user: User = Depends(get_current_user)):
    """Clone a job definition and queue a retry instance."""
    cloned = await clone_job_for_retry(str(current_user.id), job_id)
    if cloned is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "ok": True,
        "job": cloned,
    }


@router.post("/jobs/{job_id}/resume")
async def resume_job_endpoint(job_id: str, current_user: User = Depends(get_current_user)):
    """Resume a paused/resumable job."""
    resumed = await mark_job_resumed(str(current_user.id), job_id)
    if resumed is None:
        raise HTTPException(status_code=400, detail="Job is not resumable")
    return {
        "ok": True,
        "job": resumed,
    }


@router.get("/audit")
async def list_audit_logs(
    tool: str | None = Query(default=None),
    action: str | None = Query(default=None),
    status_code: int | None = Query(default=None),
    outcome: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
):
    """List immutable audit logs visible to the current user."""
    async with async_session_factory() as db:
        stmt = select(ToolAuditLog)

        # Audit visibility is controlled by server config, not user roles.
        if not config.tools_audit_global_visibility:
            stmt = stmt.where(ToolAuditLog.user_id == str(current_user.id))

        if tool:
            stmt = stmt.where(ToolAuditLog.tool == tool)
        if action:
            stmt = stmt.where(ToolAuditLog.action == action)
        if status_code is not None:
            stmt = stmt.where(ToolAuditLog.status_code == status_code)
        if outcome:
            stmt = stmt.where(ToolAuditLog.outcome == outcome)

        stmt = stmt.order_by(ToolAuditLog.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = result.scalars().all()

    entries = []
    for row in rows:
        details = {}
        if row.details_json:
            try:
                details = json.loads(row.details_json)
            except Exception:
                details = {}
        entries.append(
            {
                "id": row.id,
                "user_id": row.user_id,
                "username": row.username,
                "user_role": row.user_role,
                "method": row.method,
                "path": row.path,
                "tool": row.tool,
                "action": row.action,
                "connection_id": row.connection_id,
                "status_code": row.status_code,
                "outcome": row.outcome,
                "dry_run": bool(row.dry_run),
                "job_id": row.job_id,
                "details": details,
                "request_hash": row.request_hash,
                "prev_hash": row.prev_hash,
                "record_hash": row.record_hash,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
        )

    return {
        "entries": entries,
        "total": len(entries),
    }


@router.get("/rollback-points")
async def get_rollback_points(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
):
    """List rollback points created by safety middleware."""
    rows = await list_rollback_points(str(current_user.id), limit=limit)
    return {
        "points": rows,
        "total": len(rows),
    }


@router.post("/rollback-points/{rollback_id}/apply")
async def apply_rollback(rollback_id: str, current_user: User = Depends(get_current_user)):
    """Apply one rollback point (if supported by snapshot type)."""
    result = await apply_rollback_point(str(current_user.id), rollback_id)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message", "Rollback apply failed"))
    return result
