"""RBAC, safety, rollback, and immutable audit middleware for /api/tools."""

import hashlib
import hmac
import json
import time

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from backend.config import config
from backend.middleware.auth import get_user_from_token
from backend.services.tool_audit import hash_request_payload, record_tool_audit
from backend.services.tool_permissions import (
    is_action_allowed,
    normalize_role,
    resolve_http_tool_action,
)
from backend.services.tool_rollback import create_rollback_point


def _is_true(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def _issue_confirmation_token(user_id: str, action: str, path: str, ttl_seconds: int = 300) -> str:
    exp = int(time.time()) + max(30, int(ttl_seconds))
    payload = f"{user_id}|{action}|{path}|{exp}"
    sig = hmac.new(config.secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def _verify_confirmation_token(token: str, user_id: str, action: str, path: str) -> bool:
    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
    except Exception:
        return False
    if exp < int(time.time()):
        return False
    payload = f"{user_id}|{action}|{path}|{exp}"
    expected = hmac.new(config.secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def _restore_request_body(request: Request, body: bytes) -> None:
    async def receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive  # type: ignore[attr-defined]


def _infer_request_context(path: str, body_json: dict) -> dict:
    """Collect inferred action context for rollback snapshots."""
    out = dict(body_json)
    segments = [s for s in path.split("/") if s]
    if len(segments) >= 6 and segments[3] == "services":
        out.setdefault("service_name", segments[4])
        out.setdefault("service_action", segments[5])
    return out


class ToolsGuardMiddleware(BaseHTTPMiddleware):
    """Global guardrails for /api/tools HTTP routes."""

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        method = request.method.upper()
        if not path.startswith("/api/tools") or method == "OPTIONS":
            return await call_next(request)

        resolved = resolve_http_tool_action(method, path)
        body_bytes = await request.body()
        _restore_request_body(request, body_bytes)

        body_json: dict = {}
        if body_bytes:
            try:
                body_json = json.loads(body_bytes.decode("utf-8"))
                if not isinstance(body_json, dict):
                    body_json = {}
            except Exception:
                body_json = {}

        request_hash = hash_request_payload(body_bytes)
        auth_header = request.headers.get("authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
        user = None
        if token:
            try:
                _, user = await get_user_from_token(token)
            except HTTPException:
                user = None

        username = user.username if user else "anonymous"
        user_id = str(user.id) if user else None
        role = normalize_role(getattr(user, "role", None)) if user else "anonymous"

        if user and resolved and not is_action_allowed(role, resolved):
            response = JSONResponse(
                status_code=403,
                content={
                    "detail": "This tool action is disabled by server policy",
                    "tool": resolved.tool,
                    "action": resolved.action,
                },
            )
            await record_tool_audit(
                user_id=user_id,
                username=username,
                user_role=role,
                method=method,
                path=path,
                tool=resolved.tool if resolved else "unknown",
                action=resolved.action if resolved else "unknown",
                connection_id=resolved.connection_id if resolved else None,
                status_code=403,
                outcome="forbidden",
                dry_run=False,
                request_hash=request_hash,
            )
            return response

        dry_run = _is_true(request.query_params.get("dry_run")) or _is_true(
            request.headers.get("x-tools-dry-run")
        ) or _is_true(body_json.get("dry_run"))

        confirmation_level = str(
            body_json.get("confirmation_level")
            or request.headers.get("x-tools-confirmation-level")
            or "standard"
        ).strip().lower()
        confirm_token = str(
            body_json.get("confirmation_token")
            or request.headers.get("x-tools-confirm-token")
            or ""
        ).strip()

        if resolved and resolved.is_mutation and dry_run and user:
            suggested_token = ""
            if user and confirmation_level == "high_risk":
                suggested_token = _issue_confirmation_token(
                    user_id=str(user.id),
                    action=resolved.action,
                    path=path,
                )
            preview = {
                "dry_run": True,
                "tool": resolved.tool,
                "action": resolved.action,
                "method": method,
                "path": path,
                "change_preview": {
                    "query": dict(request.query_params),
                    "payload": body_json,
                },
                "risk_level": resolved.risk_level,
                "confirmation_level": confirmation_level,
                "confirmation_token": suggested_token,
                "confirmation_required": confirmation_level == "high_risk",
                "notes": [
                    "No changes were applied.",
                    "Use dry_run=false (or omit dry_run) to execute.",
                    "High-risk mode supports explicit confirmation tokens.",
                ],
            }
            await record_tool_audit(
                user_id=user_id,
                username=username,
                user_role=role,
                method=method,
                path=path,
                tool=resolved.tool,
                action=resolved.action,
                connection_id=resolved.connection_id,
                status_code=200,
                outcome="dry_run",
                dry_run=True,
                request_hash=request_hash,
                details={"confirmation_level": confirmation_level},
            )
            return JSONResponse(status_code=200, content=preview)

        if user and resolved and resolved.is_mutation and confirmation_level == "high_risk":
            if not confirm_token or not _verify_confirmation_token(
                confirm_token,
                user_id=str(user.id),
                action=resolved.action,
                path=path,
            ):
                return JSONResponse(
                    status_code=428,
                    content={
                        "detail": "Confirmation token required for high-risk confirmation level",
                        "confirmation_required": True,
                        "hint": "Retry with dry_run=true first to obtain a confirmation token.",
                    },
                )

        rollback_id: str | None = None
        if user and resolved and resolved.is_mutation and resolved.connection_id:
            rollback_id = await create_rollback_point(
                user_id=str(user.id),
                connection_id=resolved.connection_id,
                tool=resolved.tool,
                action=resolved.action,
                request_data=_infer_request_context(path, body_json),
            )

        try:
            response = await call_next(request)
            if rollback_id:
                response.headers["X-Rollback-Point-Id"] = rollback_id
            if resolved:
                response.headers["X-Tools-Risk-Level"] = resolved.risk_level

            await record_tool_audit(
                user_id=user_id,
                username=username,
                user_role=role,
                method=method,
                path=path,
                tool=resolved.tool if resolved else "unknown",
                action=resolved.action if resolved else "unknown",
                connection_id=resolved.connection_id if resolved else None,
                status_code=response.status_code,
                outcome="success" if response.status_code < 400 else "error",
                dry_run=False,
                request_hash=request_hash,
                details={
                    "confirmation_level": confirmation_level,
                    "rollback_point_id": rollback_id,
                },
            )
            return response
        except Exception:
            if resolved:
                await record_tool_audit(
                    user_id=user_id,
                    username=username,
                    user_role=role,
                    method=method,
                    path=path,
                    tool=resolved.tool,
                    action=resolved.action,
                    connection_id=resolved.connection_id,
                    status_code=500,
                    outcome="exception",
                    dry_run=False,
                    request_hash=request_hash,
                    details={"rollback_point_id": rollback_id},
                )
            raise
