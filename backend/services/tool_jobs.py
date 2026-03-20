"""Job engine service for long-running tools operations."""

import json
from datetime import datetime, timezone

from sqlalchemy import func, select

from backend.database import async_session_factory
from backend.models.tool_job import ToolJob, ToolJobEvent


def _to_json(value: dict | list | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def _from_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except Exception:
        return {}


def serialize_job(row: ToolJob) -> dict:
    """Convert ToolJob ORM row into API payload."""
    return {
        "id": row.id,
        "user_id": row.user_id,
        "connection_id": row.connection_id,
        "tool": row.tool,
        "action": row.action,
        "title": row.title,
        "status": row.status,
        "progress": row.progress,
        "resumable": row.resumable,
        "cancel_requested": row.cancel_requested,
        "details": _from_json(row.details_json),
        "result": _from_json(row.result_json),
        "error_message": row.error_message,
        "retry_of_job_id": row.retry_of_job_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_job_event(row: ToolJobEvent) -> dict:
    """Convert ToolJobEvent ORM row into API payload."""
    return {
        "id": row.id,
        "job_id": row.job_id,
        "sequence": row.sequence,
        "event_type": row.event_type,
        "message": row.message,
        "data": _from_json(row.data_json),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def create_job(
    *,
    user_id: str,
    tool: str,
    action: str,
    title: str,
    connection_id: str | None = None,
    details: dict | None = None,
    resumable: bool = False,
    retry_of_job_id: str | None = None,
) -> dict:
    """Create a queued job."""
    row = ToolJob(
        user_id=user_id,
        connection_id=connection_id,
        tool=tool,
        action=action,
        title=title,
        status="queued",
        progress=0,
        resumable=resumable,
        details_json=_to_json(details),
        retry_of_job_id=retry_of_job_id,
    )
    async with async_session_factory() as db:
        db.add(row)
        await db.commit()
        await db.refresh(row)
    await add_job_event(row.id, "queued", "Job queued")
    return serialize_job(row)


async def add_job_event(job_id: str, event_type: str, message: str, data: dict | None = None) -> None:
    """Append a single event to a job."""
    async with async_session_factory() as db:
        seq_result = await db.execute(
            select(func.max(ToolJobEvent.sequence)).where(ToolJobEvent.job_id == job_id)
        )
        last_seq = seq_result.scalar_one_or_none() or 0
        row = ToolJobEvent(
            job_id=job_id,
            sequence=int(last_seq) + 1,
            event_type=event_type,
            message=message,
            data_json=_to_json(data),
        )
        db.add(row)
        await db.commit()


async def set_job_running(job_id: str) -> None:
    """Mark a queued job as running."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        now = datetime.now(timezone.utc)
        row.status = "running"
        row.started_at = row.started_at or now
        row.updated_at = now
        if row.progress < 1:
            row.progress = 1
        await db.commit()
    await add_job_event(job_id, "started", "Job started")


async def update_job_progress(job_id: str, progress: int, message: str | None = None) -> None:
    """Update progress for a running job."""
    bounded = max(0, min(100, int(progress)))
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        row.progress = bounded
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()
    if message:
        await add_job_event(job_id, "progress", message, {"progress": bounded})


async def complete_job(job_id: str, result_data: dict | None = None, message: str = "Job completed") -> None:
    """Mark a job successful."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        now = datetime.now(timezone.utc)
        row.status = "succeeded"
        row.progress = 100
        row.finished_at = now
        row.updated_at = now
        row.result_json = _to_json(result_data)
        row.error_message = None
        await db.commit()
    await add_job_event(job_id, "completed", message, result_data)


async def fail_job(job_id: str, error_message: str, data: dict | None = None) -> None:
    """Mark a job failed."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        now = datetime.now(timezone.utc)
        row.status = "failed"
        row.finished_at = now
        row.updated_at = now
        row.error_message = error_message[:2000]
        if data is not None:
            row.result_json = _to_json(data)
        await db.commit()
    await add_job_event(job_id, "failed", error_message, data)


async def cancel_job(job_id: str, message: str = "Cancelled by user") -> None:
    """Mark job as cancelled."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        now = datetime.now(timezone.utc)
        row.status = "cancelled"
        row.cancel_requested = True
        row.finished_at = row.finished_at or now
        row.updated_at = now
        await db.commit()
    await add_job_event(job_id, "cancelled", message)


async def request_cancel(job_id: str) -> None:
    """Set cancel_requested flag while task shutdown is in-flight."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob).where(ToolJob.id == job_id))
        row = result.scalar_one_or_none()
        if row is None:
            return
        row.cancel_requested = True
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()
    await add_job_event(job_id, "cancel_requested", "Cancellation requested")


async def is_cancel_requested(job_id: str) -> bool:
    """Check whether a running job has received a cancel request."""
    async with async_session_factory() as db:
        result = await db.execute(select(ToolJob.cancel_requested).where(ToolJob.id == job_id))
        flag = result.scalar_one_or_none()
    return bool(flag)


async def get_job_for_user(user_id: str, job_id: str) -> dict | None:
    """Fetch one job visible to the requesting user."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(ToolJob).where(ToolJob.id == job_id, ToolJob.user_id == user_id)
        )
        row = result.scalar_one_or_none()
    return serialize_job(row) if row else None


async def get_job_events_for_user(user_id: str, job_id: str, limit: int = 500) -> list[dict]:
    """Fetch events for one job visible to user."""
    async with async_session_factory() as db:
        allowed = await db.execute(
            select(ToolJob.id).where(ToolJob.id == job_id, ToolJob.user_id == user_id)
        )
        if allowed.scalar_one_or_none() is None:
            return []
        result = await db.execute(
            select(ToolJobEvent)
            .where(ToolJobEvent.job_id == job_id)
            .order_by(ToolJobEvent.sequence.asc())
            .limit(limit)
        )
        rows = result.scalars().all()
    return [serialize_job_event(r) for r in rows]


async def list_jobs_for_user(
    user_id: str,
    *,
    status: str | None = None,
    tool: str | None = None,
    limit: int = 100,
) -> list[dict]:
    """List jobs for a user ordered by newest first."""
    async with async_session_factory() as db:
        stmt = select(ToolJob).where(ToolJob.user_id == user_id)
        if status:
            stmt = stmt.where(ToolJob.status == status)
        if tool:
            stmt = stmt.where(ToolJob.tool == tool)
        stmt = stmt.order_by(ToolJob.created_at.desc()).limit(limit)
        result = await db.execute(stmt)
        rows = result.scalars().all()
    return [serialize_job(r) for r in rows]


async def clone_job_for_retry(user_id: str, job_id: str) -> dict | None:
    """Create a new queued job from a previous failed/cancelled/succeeded job."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(ToolJob).where(ToolJob.id == job_id, ToolJob.user_id == user_id)
        )
        old = result.scalar_one_or_none()
        if old is None:
            return None
    details = _from_json(old.details_json)
    cloned = await create_job(
        user_id=user_id,
        tool=old.tool,
        action=old.action,
        title=old.title,
        connection_id=old.connection_id,
        details=details,
        resumable=old.resumable,
        retry_of_job_id=old.id,
    )
    await add_job_event(cloned["id"], "retried", f"Retry of job {old.id}", {"retry_of": old.id})
    return cloned


async def mark_job_resumed(user_id: str, job_id: str) -> dict | None:
    """Mark an existing resumable job back to queued/running flow."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(ToolJob).where(ToolJob.id == job_id, ToolJob.user_id == user_id)
        )
        row = result.scalar_one_or_none()
        if row is None or not row.resumable:
            return None
        row.status = "queued"
        row.cancel_requested = False
        row.finished_at = None
        row.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(row)
    await add_job_event(job_id, "resumed", "Job resumed")
    return serialize_job(row)
