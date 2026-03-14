"""Known SSH host key management router."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, and_

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.known_host import KnownHost
from backend.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/known-hosts", tags=["known-hosts"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class KnownHostResponse(BaseModel):
    """Response schema for a known host entry."""

    id: str
    host: str
    port: int
    key_type: str
    fingerprint: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=list[KnownHostResponse])
async def list_known_hosts(
    current_user: User = Depends(get_current_user),
) -> list[KnownHostResponse]:
    """List all known host keys for the current user."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(KnownHost)
            .where(KnownHost.user_id == current_user.id)
            .order_by(KnownHost.host, KnownHost.port)
        )
        rows = result.scalars().all()
        return [KnownHostResponse.model_validate(r) for r in rows]


@router.delete("/{host_id}")
async def delete_known_host(
    host_id: str,
    current_user: User = Depends(get_current_user),
):
    """Remove a known host key entry.

    After deletion the user will be prompted to verify the host key
    again on the next connection to that server.
    """
    async with async_session_factory() as db:
        result = await db.execute(
            select(KnownHost).where(
                and_(
                    KnownHost.id == host_id,
                    KnownHost.user_id == current_user.id,
                )
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Known host not found")

        await db.delete(entry)
        await db.commit()

    return {"ok": True}
