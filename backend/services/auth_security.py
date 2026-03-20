"""Authentication hardening helpers for public auth endpoints."""

import asyncio
import ipaddress
import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy import delete, or_, select
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from backend.config import config
from backend.database import async_session_factory
from backend.middleware.rate_limit import client_ip
from backend.models.auth_rate_limit import AuthRateLimit
from backend.models.user import User

logger = logging.getLogger(__name__)

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")


def normalize_username(value: str) -> str:
    """Normalize a user-supplied username for comparisons."""
    return value.strip()


def normalize_email(value: str | None) -> str | None:
    """Normalize an optional email for comparisons."""
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def validate_username(value: str) -> str:
    """Reject usernames with risky or ambiguous characters."""
    normalized = normalize_username(value)
    if not _USERNAME_RE.fullmatch(normalized):
        raise ValueError(
            "Username must be 3-64 characters and use only letters, numbers, dots, dashes, or underscores"
        )
    return normalized


def _ip_scope_value(request: Request) -> str:
    raw_ip = client_ip(request)
    try:
        return str(ipaddress.ip_address(raw_ip))
    except ValueError:
        return "unknown"


async def enforce_auth_rate_limit(
    *,
    scope: str,
    subject: str,
    max_requests: int,
    window_seconds: int,
    block_seconds: int,
) -> None:
    """Apply a shared, persistent sliding-window-like rate limit."""
    now = datetime.now(timezone.utc)
    window_cutoff = now - timedelta(seconds=window_seconds)

    async with async_session_factory() as session:
        result = await session.execute(select(AuthRateLimit).where(AuthRateLimit.key == subject))
        bucket = result.scalar_one_or_none()

        if bucket is None:
            bucket = AuthRateLimit(
                key=subject,
                scope=scope,
                attempt_count=1,
                window_started_at=now,
                blocked_until=None,
            )
            session.add(bucket)
            try:
                await session.commit()
                return
            except IntegrityError:
                await session.rollback()
                result = await session.execute(select(AuthRateLimit).where(AuthRateLimit.key == subject))
                bucket = result.scalar_one_or_none()
                if bucket is None:
                    raise

        blocked_until = bucket.blocked_until
        if blocked_until and blocked_until.tzinfo is None:
            blocked_until = blocked_until.replace(tzinfo=timezone.utc)

        if blocked_until and blocked_until > now:
            raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

        if bucket.window_started_at.tzinfo is None:
            bucket.window_started_at = bucket.window_started_at.replace(tzinfo=timezone.utc)

        if bucket.window_started_at <= window_cutoff:
            bucket.attempt_count = 0
            bucket.window_started_at = now
            bucket.blocked_until = None

        if bucket.attempt_count >= max_requests:
            bucket.blocked_until = now + timedelta(seconds=block_seconds)
            bucket.updated_at = now
            await session.commit()
            logger.warning("Auth rate limit triggered: scope=%s subject=%s", scope, subject)
            raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

        bucket.attempt_count += 1
        bucket.updated_at = now
        await session.commit()


async def guard_login_request(request: Request, username: str) -> None:
    """Apply layered protection for a login attempt."""
    normalized_username = normalize_username(username).lower()
    ip_value = _ip_scope_value(request)
    await enforce_auth_rate_limit(
        scope="login:ip",
        subject=f"login:ip:{ip_value}",
        max_requests=config.login_ip_limit_per_minute,
        window_seconds=60,
        block_seconds=config.login_block_seconds,
    )
    if normalized_username:
        await enforce_auth_rate_limit(
            scope="login:user",
            subject=f"login:user:{normalized_username}",
            max_requests=config.login_identifier_limit,
            window_seconds=config.login_identifier_window_seconds,
            block_seconds=config.login_block_seconds,
        )


async def guard_registration_request(
    request: Request,
    username: str,
    email: str | None,
) -> None:
    """Apply layered protection for a registration attempt."""
    ip_value = _ip_scope_value(request)
    await enforce_auth_rate_limit(
        scope="register:ip",
        subject=f"register:ip:{ip_value}",
        max_requests=config.register_ip_limit,
        window_seconds=config.register_ip_window_seconds,
        block_seconds=config.register_block_seconds,
    )

    normalized_username = normalize_username(username).lower()
    if normalized_username:
        await enforce_auth_rate_limit(
            scope="register:user",
            subject=f"register:user:{normalized_username}",
            max_requests=config.register_identifier_limit,
            window_seconds=config.register_identifier_window_seconds,
            block_seconds=config.register_block_seconds,
        )

    normalized_email = normalize_email(email)
    if normalized_email:
        await enforce_auth_rate_limit(
            scope="register:email",
            subject=f"register:email:{normalized_email}",
            max_requests=config.register_identifier_limit,
            window_seconds=config.register_identifier_window_seconds,
            block_seconds=config.register_block_seconds,
        )


async def ensure_min_failure_delay(started_at: float) -> None:
    """Pad auth failures so timing leaks are harder to exploit."""
    minimum = max(config.auth_min_failure_delay_ms, 0) / 1000
    remaining = minimum - (asyncio.get_running_loop().time() - started_at)
    if remaining > 0:
        await asyncio.sleep(remaining)


async def purge_stale_auth_rate_limits() -> int:
    """Remove expired auth rate-limit buckets so the table stays small."""
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(days=2)

    async with async_session_factory() as session:
        result = await session.execute(
            delete(AuthRateLimit).where(
                or_(
                    AuthRateLimit.updated_at < stale_cutoff,
                    AuthRateLimit.blocked_until < now,
                )
            )
        )
        await session.commit()
        return result.rowcount or 0


async def normalize_user_roles() -> int:
    """Collapse all account roles to the shared "user" role."""
    async with async_session_factory() as session:
        result = await session.execute(
            update(User).where(User.role != "user").values(role="user")
        )
        await session.commit()
        return result.rowcount or 0
