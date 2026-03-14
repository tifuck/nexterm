"""API key management router."""
import hashlib
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.api_key import ApiKey
from backend.models.user import User
from backend.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreatedResponse,
    ApiKeyPermissions,
    ApiKeyResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/keys", tags=["api-keys"])


def _hash_key(key: str) -> str:
    """SHA-256 hash of the API key for storage."""
    return hashlib.sha256(key.encode()).hexdigest()


def _parse_permissions(raw: str) -> ApiKeyPermissions:
    """Parse permissions JSON from the database."""
    try:
        data = json.loads(raw)
        return ApiKeyPermissions(**data)
    except Exception:
        return ApiKeyPermissions()


def _model_to_response(api_key: ApiKey) -> ApiKeyResponse:
    """Convert ORM model to response schema."""
    return ApiKeyResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        permissions=_parse_permissions(api_key.permissions_json),
        is_active=api_key.is_active,
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
        last_used=api_key.last_used,
    )


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(
    current_user: User = Depends(get_current_user),
) -> list[ApiKeyResponse]:
    """List all API keys for the current user."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(ApiKey)
            .where(ApiKey.user_id == current_user.id)
            .order_by(ApiKey.created_at.desc())
        )
        keys = result.scalars().all()
    return [_model_to_response(k) for k in keys]


@router.post("", response_model=ApiKeyCreatedResponse, status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    current_user: User = Depends(get_current_user),
) -> ApiKeyCreatedResponse:
    """Create a new API key. The full key is returned only once."""
    raw_key = ApiKey.generate_key()
    key_hash = _hash_key(raw_key)
    key_prefix = raw_key[:8]

    permissions_dict = body.permissions.model_dump()

    new_key = ApiKey(
        user_id=current_user.id,
        name=body.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        permissions_json=json.dumps(permissions_dict),
        expires_at=body.expires_at,
    )

    async with async_session_factory() as session:
        session.add(new_key)
        await session.commit()
        await session.refresh(new_key)

    resp = _model_to_response(new_key)
    return ApiKeyCreatedResponse(
        **resp.model_dump(),
        key=raw_key,
    )


@router.patch("/{key_id}/deactivate")
async def deactivate_api_key(
    key_id: str,
    current_user: User = Depends(get_current_user),
):
    """Deactivate an API key (soft delete)."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.user_id == current_user.id,
            )
        )
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=404, detail="API key not found")

        api_key.is_active = False
        await session.commit()

    return {"message": "API key deactivated"}


@router.patch("/{key_id}/activate")
async def activate_api_key(
    key_id: str,
    current_user: User = Depends(get_current_user),
):
    """Re-activate a deactivated API key."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.user_id == current_user.id,
            )
        )
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=404, detail="API key not found")

        api_key.is_active = True
        await session.commit()

    return {"message": "API key activated"}


@router.delete("/{key_id}", status_code=204)
async def delete_api_key(
    key_id: str,
    current_user: User = Depends(get_current_user),
):
    """Permanently delete an API key."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.user_id == current_user.id,
            )
        )
        api_key = result.scalar_one_or_none()
        if not api_key:
            raise HTTPException(status_code=404, detail="API key not found")

        await session.delete(api_key)
        await session.commit()

    return None
