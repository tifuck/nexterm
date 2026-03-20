"""JWT authentication middleware and dependencies."""

import asyncio
import hashlib
import logging
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select

from backend.config import config
from backend.database import async_session_factory
from backend.models.user import User

logger = logging.getLogger(__name__)

# Optional bearer — allows routes to work without auth header when needed
_bearer_scheme = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"

# ---------------------------------------------------------------------------
# Persistent token blocklist (database-backed with in-memory LRU cache)
# ---------------------------------------------------------------------------
# The canonical store is the ``revoked_tokens`` database table so that
# revocations survive server restarts and are shared across workers.
# A small in-memory LRU cache avoids a DB round-trip on every request.

_CACHE_MAX_SIZE = 2048
_blocklist_cache: OrderedDict[str, float] = OrderedDict()


def _hash_token(token: str) -> str:
    """SHA-256 hash of a raw JWT for storage / lookup."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_put(token_hash: str, exp: float) -> None:
    """Add an entry to the in-memory LRU cache."""
    _blocklist_cache[token_hash] = exp
    if len(_blocklist_cache) > _CACHE_MAX_SIZE:
        _blocklist_cache.popitem(last=False)


def _cache_contains(token_hash: str) -> bool:
    """Check the in-memory cache.  Returns True if found and not yet expired."""
    exp = _blocklist_cache.get(token_hash)
    if exp is None:
        return False
    if exp < time.time():
        # Naturally expired — evict from cache
        _blocklist_cache.pop(token_hash, None)
        return False
    # Move to end (most-recently-used)
    _blocklist_cache.move_to_end(token_hash)
    return True


def add_to_token_blocklist(token: str, exp: int | float) -> None:
    """Revoke a token by persisting its hash to the database.

    Also adds the entry to the in-memory cache so subsequent checks in
    the same worker are fast.

    Args:
        token: The raw JWT string.
        exp: The ``exp`` claim (UTC epoch seconds).
    """
    token_hash = _hash_token(token)
    expires_at = datetime.fromtimestamp(float(exp), tz=timezone.utc)

    # Update in-memory cache immediately (synchronous fast path)
    _cache_put(token_hash, float(exp))

    # Persist to database asynchronously.  We fire-and-forget here because
    # the caller (route handler) is itself async but we want the public API
    # of this function to stay synchronous for backward compatibility.
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_persist_revocation(token_hash, expires_at))
    except RuntimeError:
        # No running event loop — skip DB persistence (e.g. during tests)
        logger.warning("No event loop — token revocation not persisted to DB")


async def _persist_revocation(token_hash: str, expires_at: datetime) -> None:
    """Write a revoked-token row to the database."""
    from backend.models.revoked_token import RevokedToken

    try:
        async with async_session_factory() as db:
            existing = await db.execute(
                select(RevokedToken).where(RevokedToken.token_hash == token_hash)
            )
            if existing.scalar_one_or_none() is None:
                db.add(RevokedToken(token_hash=token_hash, expires_at=expires_at))
                await db.commit()
        logger.debug("Token revocation persisted (hash=%s…)", token_hash[:12])
    except Exception as e:
        logger.error("Failed to persist token revocation: %s", e)


async def is_token_blocklisted(token: str) -> bool:
    """Check whether a token has been revoked (cache then DB)."""
    token_hash = _hash_token(token)

    # Fast path: in-memory cache hit
    if _cache_contains(token_hash):
        return True

    found = await _check_db_blocklist(token_hash)
    if found:
        _cache_put(token_hash, found)
        return True

    return False


async def _check_db_blocklist(token_hash: str) -> float | None:
    """Query the revoked_tokens table.  Returns the expiry epoch or None."""
    from backend.models.revoked_token import RevokedToken

    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(RevokedToken.expires_at).where(
                    RevokedToken.token_hash == token_hash
                )
            )
            row = result.scalar_one_or_none()
            if row is not None:
                return row.timestamp()
    except Exception as e:
        logger.error("DB blocklist check failed: %s", e)
    return None


async def purge_expired_revocations() -> int:
    """Delete revoked_tokens rows that have naturally expired.

    Call this periodically (e.g. in the app lifespan or a background task)
    to keep the table small.  Returns the number of rows deleted.
    """
    from backend.models.revoked_token import RevokedToken

    try:
        async with async_session_factory() as db:
            result = await db.execute(
                delete(RevokedToken).where(
                    RevokedToken.expires_at < datetime.now(timezone.utc)
                )
            )
            await db.commit()
            count = result.rowcount  # type: ignore[union-attr]
            if count:
                logger.info("Purged %d expired token revocations", count)
            return count or 0
    except Exception as e:
        logger.error("Failed to purge expired revocations: %s", e)
        return 0


# Also purge stale entries from the in-memory cache periodically
def _purge_cache() -> None:
    """Remove expired entries from the in-memory cache."""
    now = time.time()
    expired = [h for h, exp in _blocklist_cache.items() if exp < now]
    for h in expired:
        _blocklist_cache.pop(h, None)


# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, username: str, token_version: int) -> str:
    """Create a short-lived JWT access token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "ver": token_version,
        "exp": now + timedelta(minutes=config.jwt_access_expire_minutes),
        "iat": now,
    }
    return jwt.encode(payload, config.secret_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: str, token_version: int) -> str:
    """Create a long-lived JWT refresh token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "ver": token_version,
        "exp": now + timedelta(minutes=config.jwt_refresh_expire_days * 24 * 60),
        "iat": now,
    }
    return jwt.encode(payload, config.secret_key, algorithm=ALGORITHM)


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

async def verify_token(token: str, *, allow_refresh: bool = False) -> dict:
    """Decode and validate a JWT. Returns the payload dict.

    By default, refresh tokens are rejected.  Pass ``allow_refresh=True``
    to accept refresh tokens (only appropriate in the /refresh endpoint).

    Raises HTTPException 401 on invalid or expired tokens.
    """
    # Check server-side blocklist (logout / revocation)
    if await is_token_blocklisted(token):
        raise HTTPException(status_code=401, detail="Token has been revoked")

    try:
        payload: dict = jwt.decode(token, config.secret_key, algorithms=[ALGORITHM])

        # Prevent refresh tokens from being used as access tokens.
        if payload.get("type") == "refresh" and not allow_refresh:
            raise HTTPException(
                status_code=401,
                detail="Refresh token cannot be used for authentication",
            )

        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def create_preview_token(user_id: str, connection_id: str, path: str) -> str:
    """Create a short-lived token for inline file preview."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "preview",
        "connection_id": connection_id,
        "path": path,
        "exp": now + timedelta(minutes=15),
        "iat": now,
    }
    return jwt.encode(payload, config.secret_key, algorithm=ALGORITHM)


async def verify_preview_token(token: str, connection_id: str, path: str) -> dict:
    """Validate a short-lived preview token for a specific file."""
    payload = await verify_token(token)

    if payload.get("type") != "preview":
        raise HTTPException(status_code=401, detail="Invalid token type")
    if payload.get("connection_id") != connection_id:
        raise HTTPException(status_code=401, detail="Invalid preview token")
    if payload.get("path") != path:
        raise HTTPException(status_code=401, detail="Invalid preview token")

    return payload


async def get_user_from_token(token: str, *, allow_refresh: bool = False) -> tuple[dict, User]:
    """Validate a token and return its payload plus the active user."""
    payload = await verify_token(token, allow_refresh=allow_refresh)

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="User account is disabled")

    if payload.get("ver", 0) != user.token_version:
        raise HTTPException(status_code=401, detail="Session is no longer valid")

    return payload, user


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def _extract_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    """Extract a bearer token from the Authorization header.

    Cookie-based token extraction has been removed to prevent CSRF attacks.
    Tokens must be sent via the Authorization header.
    """
    if credentials is not None:
        return credentials.credentials
    return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User:
    """Dependency that returns the authenticated User or raises 401."""
    token = _extract_token(request, credentials)
    if token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    _, user = await get_user_from_token(token)
    return user


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User | None:
    """Like get_current_user but returns None instead of raising."""
    token = _extract_token(request, credentials)
    if token is None:
        return None

    try:
        _, user = await get_user_from_token(token)
    except HTTPException:
        return None

    return user
