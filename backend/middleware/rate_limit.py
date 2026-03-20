"""In-memory IP-based rate limiting middleware."""

import ipaddress
import logging
import time
from collections import defaultdict
from typing import NamedTuple

from fastapi import HTTPException, Request

from backend.config import config

logger = logging.getLogger(__name__)


class _Bucket(NamedTuple):
    """Sliding-window counter for a single IP."""
    timestamps: list[float]


# ip -> list of request timestamps (kept trimmed to the window)
_buckets: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    """Best-effort extraction of the real client IP.

    Respects X-Forwarded-For when present (reverse-proxy deployments).
    Falls back to the direct connecting address.
    """
    direct_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and _is_trusted_proxy(direct_ip):
        # First entry is the original client
        return forwarded.split(",")[0].strip()
    return direct_ip


def _is_trusted_proxy(ip: str) -> bool:
    """Return whether the direct peer is a configured trusted proxy."""
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False

    for entry in config.trusted_proxies:
        try:
            if "/" in entry:
                if address in ipaddress.ip_network(entry, strict=False):
                    return True
            elif address == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue

    return False


def check_rate_limit(
    request: Request,
    *,
    max_requests: int,
    window_seconds: int,
    key_suffix: str = "",
) -> None:
    """Raise HTTP 429 if the caller exceeds the rate limit.

    Args:
        request: The incoming FastAPI request.
        max_requests: Maximum number of requests allowed in the window.
        window_seconds: Size of the sliding window in seconds.
        key_suffix: Optional suffix to namespace different limits
                    (e.g. "login" vs "register").
    """
    ip = client_ip(request)
    key = f"{ip}:{key_suffix}" if key_suffix else ip
    now = time.monotonic()
    cutoff = now - window_seconds

    # Trim old entries and append the current one
    bucket = _buckets[key]
    _buckets[key] = [ts for ts in bucket if ts > cutoff]
    bucket = _buckets[key]

    if len(bucket) >= max_requests:
        logger.warning(
            "Rate limit exceeded: ip=%s key=%s (%d requests in %ds)",
            ip, key_suffix, len(bucket), window_seconds,
        )
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
        )

    bucket.append(now)
