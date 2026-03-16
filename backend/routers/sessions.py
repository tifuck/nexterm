"""Session CRUD routes."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.session import SavedSession, SessionType
from backend.models.user import User
from backend.schemas.session import (
    SessionCreate,
    SessionCredentialsResponse,
    SessionResponse,
    SessionUpdate,
)
from backend.services.ssh_proxy import ssh_proxy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class ReorderItem(BaseModel):
    id: str
    sort_order: int


class MoveSessionsRequest(BaseModel):
    session_ids: list[str]
    folder_id: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _session_to_response(s: SavedSession) -> SessionResponse:
    return SessionResponse(
        id=str(s.id),
        folder_id=str(s.folder_id) if s.folder_id else None,
        name=s.name,
        session_type=s.session_type,
        host=s.host,
        port=s.port,
        username=s.username,
        color=s.color,
        icon=s.icon,
        sort_order=s.sort_order,
        settings=s.settings_json,
        protocol_settings=s.protocol_settings_json,
        last_connected=s.last_connected,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


async def _get_session_or_404(session_id: str, user_id: str) -> SavedSession:
    """Fetch a session and verify ownership."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(SavedSession).where(SavedSession.id == session_id)
        )
        saved = result.scalar_one_or_none()

    if saved is None or str(saved.user_id) != str(user_id):
        raise HTTPException(status_code=404, detail="Session not found")

    return saved


# ---------------------------------------------------------------------------
# GET / — list sessions
# ---------------------------------------------------------------------------

@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    folder_id: str | None = Query(None),
    current_user: User = Depends(get_current_user),
):
    """List all sessions belonging to the current user."""
    async with async_session_factory() as db:
        stmt = select(SavedSession).where(
            SavedSession.user_id == current_user.id
        )
        if folder_id is not None:
            stmt = stmt.where(SavedSession.folder_id == folder_id)
        stmt = stmt.order_by(SavedSession.sort_order, SavedSession.name)
        result = await db.execute(stmt)
        sessions = result.scalars().all()

    return [_session_to_response(s) for s in sessions]


# ---------------------------------------------------------------------------
# POST / — create session
# ---------------------------------------------------------------------------

@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(
    body: SessionCreate,
    current_user: User = Depends(get_current_user),
):
    """Create a new saved session.

    Credential fields (encrypted_password, encrypted_ssh_key, encrypted_passphrase)
    are expected to be client-side encrypted ciphertext and are stored as-is.
    """
    async with async_session_factory() as db:
        saved = SavedSession(
            user_id=current_user.id,
            folder_id=body.folder_id,
            name=body.name,
            session_type=body.session_type or SessionType.SSH,
            host=body.host,
            port=body.port or 22,
            username=body.username,
            encrypted_password=body.encrypted_password,
            encrypted_ssh_key=body.encrypted_ssh_key,
            encrypted_passphrase=body.encrypted_passphrase,
            color=body.color,
            icon=body.icon,
            settings_json=body.settings if isinstance(body.settings, str) else None,
            protocol_settings_json=body.protocol_settings if isinstance(body.protocol_settings, str) else None,
        )
        db.add(saved)
        await db.commit()
        await db.refresh(saved)

    return _session_to_response(saved)


# ---------------------------------------------------------------------------
# PUT /reorder
# NOTE: Static routes must be defined BEFORE /{session_id} to avoid path
# conflicts where "reorder" or "credentials" is matched as a session_id.
# ---------------------------------------------------------------------------

@router.put("/reorder", status_code=200)
async def reorder_sessions(
    items: list[ReorderItem],
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        for item in items:
            result = await db.execute(
                select(SavedSession).where(SavedSession.id == item.id)
            )
            saved = result.scalar_one_or_none()

            if saved is None or str(saved.user_id) != str(current_user.id):
                continue  # Skip invalid items silently

            saved.sort_order = item.sort_order

        await db.commit()

    return {"detail": "Sessions reordered"}


# ---------------------------------------------------------------------------
# PUT /move — bulk-move sessions to a folder (or to root)
# ---------------------------------------------------------------------------

@router.put("/move", status_code=200)
async def move_sessions(
    body: MoveSessionsRequest,
    current_user: User = Depends(get_current_user),
):
    """Move one or more sessions into a folder, or to root (folder_id=null)."""
    async with async_session_factory() as db:
        for sid in body.session_ids:
            result = await db.execute(
                select(SavedSession).where(SavedSession.id == sid)
            )
            saved = result.scalar_one_or_none()
            if saved is None or str(saved.user_id) != str(current_user.id):
                continue
            saved.folder_id = body.folder_id
            saved.updated_at = datetime.now(timezone.utc)

        await db.commit()

    return {"detail": f"{len(body.session_ids)} session(s) moved"}


# ---------------------------------------------------------------------------
# GET /credentials/bulk — all credentials for the current user
# ---------------------------------------------------------------------------

@router.get("/credentials/bulk", response_model=list[SessionCredentialsResponse])
async def get_all_credentials(
    current_user: User = Depends(get_current_user),
):
    """Return encrypted credential blobs for all of the user's sessions.

    Used during password-change re-encryption: the frontend downloads all
    ciphertext, decrypts with the old key, re-encrypts with the new key,
    and PUTs each session back.
    """
    async with async_session_factory() as db:
        result = await db.execute(
            select(SavedSession).where(SavedSession.user_id == current_user.id)
        )
        sessions = result.scalars().all()

    return [
        SessionCredentialsResponse(
            id=str(s.id),
            encrypted_password=s.encrypted_password,
            encrypted_ssh_key=s.encrypted_ssh_key,
            encrypted_passphrase=s.encrypted_passphrase,
        )
        for s in sessions
    ]


# ---------------------------------------------------------------------------
# GET /{session_id}/active — list active SSH connections for this session
# ---------------------------------------------------------------------------

@router.get("/{session_id}/active")
async def get_active_connections(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return active SSH connections for a saved session.

    Used by the frontend to detect when a session is already connected
    (possibly on another device) and offer to attach to it.
    """
    # Verify ownership
    await _get_session_or_404(session_id, str(current_user.id))

    try:
        connections = await ssh_proxy.find_active_by_session_id(
            str(current_user.id), session_id,
        )
        # Filter to only return useful fields
        return [
            {
                "connection_id": c["connection_id"],
                "created_at": c.get("created_at", ""),
            }
            for c in connections
        ]
    except Exception as e:
        logger.error("Failed to query active connections: %s", e)
        return []


# ---------------------------------------------------------------------------
# GET /{session_id}
# ---------------------------------------------------------------------------

@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    saved = await _get_session_or_404(session_id, str(current_user.id))
    return _session_to_response(saved)


# ---------------------------------------------------------------------------
# GET /{session_id}/credentials — return encrypted credential blobs
# ---------------------------------------------------------------------------

@router.get("/{session_id}/credentials", response_model=SessionCredentialsResponse)
async def get_session_credentials(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return the client-side encrypted credential blobs for a saved session.

    The backend cannot decrypt these — only the frontend with the user's
    derived key can.
    """
    saved = await _get_session_or_404(session_id, str(current_user.id))
    return SessionCredentialsResponse(
        id=str(saved.id),
        encrypted_password=saved.encrypted_password,
        encrypted_ssh_key=saved.encrypted_ssh_key,
        encrypted_passphrase=saved.encrypted_passphrase,
    )


# ---------------------------------------------------------------------------
# PUT /{session_id}
# ---------------------------------------------------------------------------

@router.put("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    body: SessionUpdate,
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        result = await db.execute(
            select(SavedSession).where(SavedSession.id == session_id)
        )
        saved = result.scalar_one_or_none()

        if saved is None or str(saved.user_id) != str(current_user.id):
            raise HTTPException(status_code=404, detail="Session not found")

        update_data = body.model_dump(exclude_unset=True)

        # Credential fields are already client-side encrypted — store directly
        for cred_field in ("encrypted_password", "encrypted_ssh_key", "encrypted_passphrase"):
            if cred_field in update_data:
                setattr(saved, cred_field, update_data.pop(cred_field))

        # Map schema fields to model fields
        field_map = {
            "settings": "settings_json",
            "protocol_settings": "protocol_settings_json",
        }

        for field, value in update_data.items():
            model_field = field_map.get(field, field)
            if hasattr(saved, model_field):
                setattr(saved, model_field, value)

        saved.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(saved)

    return _session_to_response(saved)


# ---------------------------------------------------------------------------
# DELETE /{session_id}
# ---------------------------------------------------------------------------

@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    async with async_session_factory() as db:
        result = await db.execute(
            select(SavedSession).where(SavedSession.id == session_id)
        )
        saved = result.scalar_one_or_none()

        if saved is None or str(saved.user_id) != str(current_user.id):
            raise HTTPException(status_code=404, detail="Session not found")

        await db.delete(saved)
        await db.commit()


# ---------------------------------------------------------------------------
# POST /{session_id}/duplicate
# ---------------------------------------------------------------------------

@router.post("/{session_id}/duplicate", response_model=SessionResponse, status_code=201)
async def duplicate_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    original = await _get_session_or_404(session_id, str(current_user.id))

    async with async_session_factory() as db:
        duplicate = SavedSession(
            user_id=current_user.id,
            folder_id=original.folder_id,
            name=f"{original.name} (copy)",
            session_type=original.session_type,
            host=original.host,
            port=original.port,
            username=original.username,
            encrypted_password=original.encrypted_password,
            encrypted_ssh_key=original.encrypted_ssh_key,
            encrypted_passphrase=original.encrypted_passphrase,
            color=original.color,
            icon=original.icon,
            sort_order=original.sort_order,
            settings_json=original.settings_json,
            protocol_settings_json=original.protocol_settings_json,
        )
        db.add(duplicate)
        await db.commit()
        await db.refresh(duplicate)

    return _session_to_response(duplicate)
