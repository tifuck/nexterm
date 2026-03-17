"""JWT authentication middleware and dependencies."""

import logging
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from backend.config import config
from backend.database import async_session_factory
from backend.models.user import User

logger = logging.getLogger(__name__)

# Optional bearer — allows routes to work without auth header when needed
_bearer_scheme = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"

# ---------------------------------------------------------------------------
# In-memory token blocklist (for server-side logout / revocation)
# ---------------------------------------------------------------------------
# Maps token string -> expiry timestamp (UTC epoch).  Tokens are purged on
# each insertion once they've naturally expired, keeping memory bounded.

_token_blocklist: dict[str, float] = {}


def add_to_token_blocklist(token: str, exp: int | float) -> None:
    """Add a token to the blocklist so it is rejected by verify_token.

    Args:
        token: The raw JWT string.
        exp: The ``exp`` claim (UTC epoch seconds).
    """
    _purge_expired_tokens()
    _token_blocklist[token] = float(exp)
    logger.debug("Token added to blocklist (blocklist size: %d)", len(_token_blocklist))


def is_token_blocklisted(token: str) -> bool:
    """Check whether a token has been revoked."""
    return token in _token_blocklist


def _purge_expired_tokens() -> None:
    """Remove tokens that have naturally expired (housekeeping)."""
    now = time.time()
    expired = [t for t, exp in _token_blocklist.items() if exp < now]
    for t in expired:
        del _token_blocklist[t]


# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, username: str, is_admin: bool) -> str:
    """Create a short-lived JWT access token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "is_admin": is_admin,
        "exp": now + timedelta(minutes=config.jwt_access_expire_minutes),
        "iat": now,
    }
    return jwt.encode(payload, config.secret_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """Create a long-lived JWT refresh token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": now + timedelta(minutes=config.jwt_refresh_expire_days * 24 * 60),
        "iat": now,
    }
    return jwt.encode(payload, config.secret_key, algorithm=ALGORITHM)


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

def verify_token(token: str, *, allow_refresh: bool = False) -> dict:
    """Decode and validate a JWT. Returns the payload dict.

    By default, refresh tokens are rejected.  Pass ``allow_refresh=True``
    to accept refresh tokens (only appropriate in the /refresh endpoint).

    Raises HTTPException 401 on invalid or expired tokens.
    """
    # Check server-side blocklist (logout / revocation)
    if is_token_blocklisted(token):
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

    payload = verify_token(token)

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

    return user


async def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency that ensures the current user is an admin."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User | None:
    """Like get_current_user but returns None instead of raising."""
    token = _extract_token(request, credentials)
    if token is None:
        return None

    try:
        payload = verify_token(token)
    except HTTPException:
        return None

    user_id = payload.get("sub")
    if user_id is None:
        return None

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        return None

    return user
