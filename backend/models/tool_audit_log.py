"""Immutable audit log model for server tools actions."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class ToolAuditLog(Base):
    """Append-only audit trail with hash chaining."""

    __tablename__ = "tool_audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    user_role: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")

    method: Mapped[str] = mapped_column(String(16), nullable=False, default="GET")
    path: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    tool: Mapped[str] = mapped_column(String(64), nullable=False, default="unknown", index=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, default="unknown", index=True)
    connection_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    dry_run: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    record_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="", unique=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
