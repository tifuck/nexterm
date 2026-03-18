"""Authentication routes — login, register, refresh, and current-user info."""

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select

from backend.config import config
from backend.database import async_session_factory
from backend.middleware.auth import (
    add_to_token_blocklist,
    create_access_token,
    create_refresh_token,
    get_current_user,
    verify_token,
)
from backend.middleware.rate_limit import check_rate_limit
from backend.models.user import User
from backend.schemas.auth import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# Explicit cost factor — prevents regression if library default ever changes.
_BCRYPT_ROUNDS = 12


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(
        plain.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    ).decode("utf-8")


# ---------------------------------------------------------------------------
# POST /login
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request):
    """Authenticate a user and return access + refresh tokens."""
    # Rate-limit: 10 login attempts per minute per IP
    check_rate_limit(request, max_requests=10, window_seconds=60, key_suffix="login")

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.username == body.username)
        )
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        # Check account lockout (uses configurable values)
        max_attempts = config.max_login_attempts
        lockout_minutes = config.lockout_duration_minutes
        if user.locked_until:
            locked = user.locked_until
            if locked.tzinfo is None:
                locked = locked.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < locked:
                # Use the same generic error to prevent username enumeration
                raise HTTPException(
                    status_code=401,
                    detail="Invalid username or password",
                )
            # Lockout period expired — reset counter
            user.failed_login_attempts = 0
            user.last_failed_login = None
            user.locked_until = None

        if not user.is_active:
            # Use the same generic error to prevent username enumeration
            raise HTTPException(status_code=401, detail="Invalid username or password")

        if not _check_password(body.password, user.password_hash):
            user.failed_login_attempts += 1
            user.last_failed_login = datetime.now(timezone.utc)
            # Lock the account if max attempts reached
            if user.failed_login_attempts >= max_attempts:
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=lockout_minutes)
            await session.commit()
            raise HTTPException(status_code=401, detail="Invalid username or password")

        # Successful login — reset failures, update last_login
        user.failed_login_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.now(timezone.utc)
        await session.commit()

    access_token = create_access_token(
        user_id=str(user.id),
        username=user.username,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        encryption_salt=user.encryption_salt,
    )


# ---------------------------------------------------------------------------
# POST /register
# ---------------------------------------------------------------------------

@router.post("/register", response_model=UserResponse, status_code=201)
async def register(body: RegisterRequest, request: Request):
    """Register a new user account."""
    # Rate-limit: 5 registrations per hour per IP
    check_rate_limit(request, max_requests=5, window_seconds=3600, key_suffix="register")

    if not config.registration_enabled:
        raise HTTPException(status_code=403, detail="Registration is currently disabled")

    async with async_session_factory() as session:
        # Check username uniqueness (generic error to prevent enumeration)
        result = await session.execute(
            select(User).where(User.username == body.username)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409,
                detail="Registration failed. Please try a different username or email.",
            )

        # Check email uniqueness (only if email is provided)
        if body.email:
            result = await session.execute(
                select(User).where(User.email == body.email)
            )
            if result.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=409,
                    detail="Registration failed. Please try a different username or email.",
                )

        user = User(
            username=body.username,
            email=body.email,
            password_hash=_hash_password(body.password),
            encryption_salt=secrets.token_hex(32),
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login=user.last_login,
        encryption_salt=user.encryption_salt,
    )


# ---------------------------------------------------------------------------
# POST /refresh
# ---------------------------------------------------------------------------

@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    payload = verify_token(body.refresh_token, allow_refresh=True)

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Blocklist the old refresh token to prevent replay attacks.
    old_exp = payload.get("exp")
    if old_exp:
        add_to_token_blocklist(body.refresh_token, old_exp)

    access_token = create_access_token(
        user_id=str(user.id),
        username=user.username,
    )
    new_refresh_token = create_refresh_token(user_id=str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        encryption_salt=user.encryption_salt,
    )


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    import json as _json

    settings = {}
    if current_user.settings_json:
        try:
            settings = _json.loads(current_user.settings_json)
        except Exception:
            pass

    return UserResponse(
        id=str(current_user.id),
        username=current_user.username,
        email=current_user.email,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        last_login=current_user.last_login,
        settings=settings,
        encryption_salt=current_user.encryption_salt,
    )


# ---------------------------------------------------------------------------
# GET /settings
# ---------------------------------------------------------------------------

@router.get("/settings")
async def get_settings(current_user: User = Depends(get_current_user)):
    """Return the current user's settings."""
    import json as _json

    settings = {}
    if current_user.settings_json:
        try:
            settings = _json.loads(current_user.settings_json)
        except Exception:
            pass
    return settings


# ---------------------------------------------------------------------------
# PUT /settings
# ---------------------------------------------------------------------------

@router.put("/settings")
async def update_settings(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """Update the current user's settings (merge with existing)."""
    import json as _json

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")

        # Merge existing settings with new ones
        existing = {}
        if user.settings_json:
            try:
                existing = _json.loads(user.settings_json)
            except Exception:
                pass

        existing.update(body)
        user.settings_json = _json.dumps(existing)
        await session.commit()

    return existing


# ---------------------------------------------------------------------------
# POST /change-password
# ---------------------------------------------------------------------------

@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
):
    """Change the current user's password and rotate the E2EE encryption salt.

    The frontend is responsible for re-encrypting all stored credentials
    with the new key derived from the new password + new salt.
    """
    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")

        if not _check_password(body.old_password, user.password_hash):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        user.password_hash = _hash_password(body.new_password)
        user.encryption_salt = secrets.token_hex(32)
        await session.commit()

    return ChangePasswordResponse(encryption_salt=user.encryption_salt)


# ---------------------------------------------------------------------------
# POST /logout
# ---------------------------------------------------------------------------

@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    body: LogoutRequest | None = None,
):
    """Invalidate the current access token and optional refresh token."""
    # Blocklist the access token from the Authorization header
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        payload = verify_token(token)
        exp = payload.get("exp")
        if exp:
            add_to_token_blocklist(token, exp)

    # Blocklist the refresh token if the client sent it
    if body and body.refresh_token:
        try:
            r_payload = verify_token(body.refresh_token, allow_refresh=True)
            r_exp = r_payload.get("exp")
            if r_exp:
                add_to_token_blocklist(body.refresh_token, r_exp)
        except HTTPException:
            pass  # Token already expired or invalid — nothing to blocklist

    return None
