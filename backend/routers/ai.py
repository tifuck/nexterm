"""AI assistance endpoints."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.database import async_session_factory
from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.services.ai_service import (
    AI_FEATURE_NAMES,
    AI_PROVIDER_NAMES,
    COMMAND_SYSTEM_PROMPT,
    DEFAULT_AI_FEATURES,
    DIAGNOSE_SYSTEM_PROMPT,
    EXPLAIN_SYSTEM_PROMPT,
    call_ai,
    check_ai_feature,
    get_ai_client,
    get_user_features,
    is_provider_configured,
    parse_ai_settings,
    validate_ollama_url,
)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class CommandRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)
    context: str | None = Field(default=None, max_length=3000)
    history: list[str] | None = Field(default=None, max_length=20)


class DiagnoseRequest(BaseModel):
    error_output: str = Field(..., min_length=1, max_length=20000)
    command: str | None = Field(default=None, max_length=2000)
    context: str | None = Field(default=None, max_length=3000)


class ExplainRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=2000)


class AISettingsUpdate(BaseModel):
    provider: str = Field(..., min_length=1, max_length=32)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_api_key: bool = False
    model: str | None = Field(default=None, max_length=255)
    base_url: str | None = Field(default=None, max_length=1024)


class AIFeaturesUpdate(BaseModel):
    enabled: bool = True
    features: dict[str, bool] = Field(default_factory=dict)


def _mask_key(value: str) -> str:
    """Return a safe masked key for settings UI."""
    if not value:
        return ""
    if len(value) <= 12:
        return "***"
    return f"{value[:8]}...{value[-4:]}"


@router.post("/command")
async def generate_command(
    request: CommandRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a shell command from natural language."""
    await check_ai_feature(current_user, "command_generation")
    settings = await get_ai_client(current_user)

    prompt = request.prompt.strip()
    if request.context:
        prompt += f"\n\nContext:\n{request.context.strip()}"
    if request.history:
        recent = [cmd.strip() for cmd in request.history if cmd.strip()]
        if recent:
            prompt += f"\n\nRecent commands: {', '.join(recent[-8:])}"

    result = await call_ai(settings, COMMAND_SYSTEM_PROMPT, prompt)
    return {"command": result.strip()}


@router.post("/diagnose")
async def diagnose_error(
    request: DiagnoseRequest,
    current_user: User = Depends(get_current_user),
):
    """Diagnose an error from terminal output."""
    await check_ai_feature(current_user, "error_diagnosis")
    settings = await get_ai_client(current_user)

    prompt = f"Error output:\n```\n{request.error_output.strip()}\n```"
    if request.command:
        prompt = f"Command: `{request.command.strip()}`\n\n{prompt}"
    if request.context:
        prompt += f"\n\nContext:\n{request.context.strip()}"

    result = await call_ai(settings, DIAGNOSE_SYSTEM_PROMPT, prompt)
    return {"diagnosis": result.strip()}


@router.post("/explain")
async def explain_command(
    request: ExplainRequest,
    current_user: User = Depends(get_current_user),
):
    """Explain what a command does."""
    await check_ai_feature(current_user, "command_explanation")
    settings = await get_ai_client(current_user)
    result = await call_ai(settings, EXPLAIN_SYSTEM_PROMPT, request.command.strip())
    return {"explanation": result.strip()}


@router.put("/settings")
async def update_ai_settings(
    body: AISettingsUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update user's AI provider settings."""
    from backend.services.encryption import encrypt_sensitive

    provider = body.provider.strip().lower()
    if provider not in AI_PROVIDER_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown AI provider: {provider}")

    base_url = (body.base_url or "").strip()
    if provider == "ollama" and base_url:
        validate_ollama_url(base_url)

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        existing: dict = {}
        if user.ai_settings_json:
            try:
                existing = json.loads(user.ai_settings_json)
            except json.JSONDecodeError:
                existing = {}

        existing_encrypted = existing.get("api_key_encrypted", "")
        if not existing_encrypted and existing.get("api_key"):
            existing_encrypted = encrypt_sensitive(existing["api_key"]) or ""

        if body.clear_api_key:
            encrypted_key = ""
        elif body.api_key is not None:
            clean_key = body.api_key.strip()
            encrypted_key = encrypt_sensitive(clean_key) if clean_key else ""
        else:
            encrypted_key = existing_encrypted

        if provider in {"openai", "anthropic"} and not encrypted_key:
            raise HTTPException(
                status_code=400,
                detail=f"{provider.title()} API key is required",
            )

        user.ai_settings_json = json.dumps(
            {
                "provider": provider,
                "api_key_encrypted": encrypted_key,
                "model": (body.model or "").strip(),
                "base_url": base_url,
            }
        )
        await session.commit()

    return {"message": "AI settings updated"}


@router.get("/settings")
async def get_ai_settings(
    current_user: User = Depends(get_current_user),
):
    """Get user's AI settings (without exposing API key)."""
    settings = parse_ai_settings(current_user)
    api_key = settings.get("api_key", "")

    return {
        "provider": settings.get("provider", ""),
        "model": settings.get("model", ""),
        "base_url": settings.get("base_url", ""),
        "has_api_key": bool(api_key),
        "api_key_masked": _mask_key(api_key) if api_key else "",
        "is_configured": is_provider_configured(settings),
    }


@router.get("/features")
async def get_ai_features(
    current_user: User = Depends(get_current_user),
):
    """Get user's per-feature AI toggles."""
    return get_user_features(current_user)


@router.put("/features")
async def update_ai_features(
    body: AIFeaturesUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update user's per-feature AI toggles."""
    unknown = set(body.features.keys()) - AI_FEATURE_NAMES
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown AI feature(s): {', '.join(sorted(unknown))}",
        )

    merged = dict(DEFAULT_AI_FEATURES)
    merged.update(body.features)

    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.id == current_user.id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user.ai_features_json = json.dumps({"enabled": body.enabled, "features": merged})
        await session.commit()

    return {"enabled": body.enabled, "features": merged}
