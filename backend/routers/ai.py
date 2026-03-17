"""AI assistance endpoints."""
import ipaddress
import json
import logging
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.config import config
from backend.database import async_session_factory

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known AI features and defaults
# ---------------------------------------------------------------------------

AI_FEATURE_NAMES = {
    "command_generation",
    "error_diagnosis",
    "command_explanation",
    "log_analysis",
}

_DEFAULT_FEATURES = {name: True for name in AI_FEATURE_NAMES}

# ---------------------------------------------------------------------------
# SSRF protection for user-supplied Ollama URLs
# ---------------------------------------------------------------------------

_ALLOWED_OLLAMA_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _validate_ollama_url(url: str) -> None:
    """Reject Ollama base URLs that could cause SSRF.

    Only allows localhost addresses and private/link-local RFC 1918
    addresses.  Blocks cloud metadata endpoints, public IPs, and
    non-HTTP(S) schemes.

    Raises:
        HTTPException 400 on invalid or disallowed URLs.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Ollama base URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail=f"Ollama URL must use http or https scheme, got '{parsed.scheme}'",
        )

    hostname = parsed.hostname or ""

    # Allow well-known localhost names
    if hostname in _ALLOWED_OLLAMA_HOSTS:
        return

    # Allow Docker-style service names (alphanumeric + hyphens, no dots)
    # that resolve internally (e.g. "ollama", "my-ollama-service")
    if hostname and "." not in hostname and hostname.replace("-", "").isalnum():
        return

    # Allow private network IPs (RFC 1918 / RFC 4193)
    try:
        addr = ipaddress.ip_address(hostname)
        if addr.is_private or addr.is_loopback:
            return
        raise HTTPException(
            status_code=400,
            detail="Ollama URL must point to a private or localhost address",
        )
    except ValueError:
        pass

    # Allow fully-qualified hostnames that resolve to common internal TLDs
    # but block everything else to prevent SSRF to cloud metadata, etc.
    raise HTTPException(
        status_code=400,
        detail="Ollama URL must point to localhost or a private network address",
    )


router = APIRouter(prefix="/api/ai", tags=["ai"])


class CommandRequest(BaseModel):
    prompt: str
    context: Optional[str] = None  # Current directory, OS info, etc.
    history: Optional[list[str]] = None  # Recent commands


class DiagnoseRequest(BaseModel):
    error_output: str
    command: Optional[str] = None
    context: Optional[str] = None


class ExplainRequest(BaseModel):
    command: str


class AISettingsUpdate(BaseModel):
    provider: str  # "openai", "anthropic", "ollama"
    api_key: Optional[str] = None  # Not needed for Ollama
    model: Optional[str] = None
    base_url: Optional[str] = None  # For Ollama or custom endpoints


class AIFeaturesUpdate(BaseModel):
    enabled: bool = True
    features: dict[str, bool] = {}


async def get_ai_client(user: User):
    """Get the AI client based on user's settings."""
    if not config.ai_enabled:
        raise HTTPException(status_code=403, detail="AI features are disabled")

    from backend.services.encryption import decrypt_sensitive

    ai_settings = {}
    if user.ai_settings_json:
        try:
            ai_settings = json.loads(user.ai_settings_json)
        except json.JSONDecodeError:
            pass

    provider = ai_settings.get("provider", "")
    # Support both legacy plaintext "api_key" and new encrypted "api_key_encrypted"
    api_key = ""
    if ai_settings.get("api_key_encrypted"):
        api_key = decrypt_sensitive(ai_settings["api_key_encrypted"]) or ""
    elif ai_settings.get("api_key"):
        # Legacy plaintext — will be upgraded on next settings save
        api_key = ai_settings["api_key"]
    model = ai_settings.get("model", "")
    base_url = ai_settings.get("base_url", "")
    
    if not provider:
        raise HTTPException(
            status_code=400,
            detail="AI provider not configured. Go to Settings > AI to set up."
        )
    
    return {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
    }


async def call_ai(settings: dict, system_prompt: str, user_prompt: str) -> str:
    """Call the configured AI provider."""
    provider = settings["provider"]
    
    if provider == "openai":
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=settings["api_key"])
            response = await client.chat.completions.create(
                model=settings.get("model") or "gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=1024,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")
    
    elif provider == "anthropic":
        try:
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=settings["api_key"])
            response = await client.messages.create(
                model=settings.get("model") or "claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            return response.content[0].text if response.content else ""
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Anthropic error: {str(e)}")
    
    elif provider == "ollama":
        try:
            import httpx
            base_url = settings.get("base_url") or "http://localhost:11434"
            _validate_ollama_url(base_url)
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{base_url}/api/chat",
                    json={
                        "model": settings.get("model") or "llama3.2",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                        "stream": False,
                    },
                )
                data = response.json()
                return data.get("message", {}).get("content", "")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Ollama error: {str(e)}")
    
    else:
        raise HTTPException(status_code=400, detail=f"Unknown AI provider: {provider}")


# ---------------------------------------------------------------------------
# Per-user feature toggles
# ---------------------------------------------------------------------------


def _get_user_features(user: User) -> dict:
    """Parse user's ai_features_json with defaults.

    Returns:
        Dict with ``enabled`` (bool) and ``features`` (dict[str, bool]).
    """
    result = {"enabled": True, "features": dict(_DEFAULT_FEATURES)}
    if user.ai_features_json:
        try:
            stored = json.loads(user.ai_features_json)
            result["enabled"] = stored.get("enabled", True)
            stored_features = stored.get("features", {})
            for name in AI_FEATURE_NAMES:
                result["features"][name] = stored_features.get(name, True)
        except json.JSONDecodeError:
            pass
    return result


async def check_ai_feature(user: User, feature_name: str) -> None:
    """Raise 403 if a specific AI feature is disabled.

    Checks three levels:
    1. Global server config (``config.ai_enabled``)
    2. User master toggle (``ai_features_json.enabled``)
    3. Individual feature toggle (``ai_features_json.features.<name>``)
    """
    if not config.ai_enabled:
        raise HTTPException(
            status_code=403,
            detail="AI features are disabled by the administrator",
        )

    feat = _get_user_features(user)
    if not feat["enabled"]:
        raise HTTPException(
            status_code=403,
            detail="AI is disabled in your settings",
        )
    if not feat["features"].get(feature_name, True):
        raise HTTPException(
            status_code=403,
            detail=f"The '{feature_name}' AI feature is disabled in your settings",
        )


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

COMMAND_SYSTEM_PROMPT = """You are a Linux/Unix command-line assistant. Given a natural language description, generate the appropriate shell command(s).

Rules:
- Return ONLY the command(s), no explanations
- If multiple commands are needed, separate with && or put on separate lines
- Use common, portable commands when possible
- If the request is ambiguous, provide the most likely interpretation
- Consider the context (OS, current directory) if provided"""

DIAGNOSE_SYSTEM_PROMPT = """You are a Linux/Unix system administrator assistant. Analyze the error output and provide:

1. A brief explanation of what went wrong
2. The most likely cause
3. A suggested fix (command or action)

Be concise and practical. Format your response as:
**Problem:** [one-line explanation]
**Cause:** [most likely cause]
**Fix:** [command or action to resolve]"""

EXPLAIN_SYSTEM_PROMPT = """You are a Linux/Unix command-line teacher. Explain what the given command does in simple terms.

Break down each part of the command. Be concise but thorough. If the command is dangerous, warn the user."""


@router.post("/command")
async def generate_command(
    request: CommandRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a shell command from natural language."""
    await check_ai_feature(current_user, "command_generation")
    settings = await get_ai_client(current_user)
    
    prompt = request.prompt
    if request.context:
        prompt += f"\n\nContext: {request.context}"
    if request.history:
        prompt += f"\n\nRecent commands: {', '.join(request.history[-5:])}"
    
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
    
    prompt = f"Error output:\n```\n{request.error_output}\n```"
    if request.command:
        prompt = f"Command: `{request.command}`\n\n{prompt}"
    if request.context:
        prompt += f"\n\nContext: {request.context}"
    
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
    result = await call_ai(settings, EXPLAIN_SYSTEM_PROMPT, request.command)
    return {"explanation": result.strip()}


# ---------------------------------------------------------------------------
# Settings endpoints
# ---------------------------------------------------------------------------


@router.put("/settings")
async def update_ai_settings(
    body: AISettingsUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update user's AI provider settings."""
    from backend.services.encryption import encrypt_sensitive

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.id == current_user.id)
        )
        user = result.scalar_one_or_none()
        if user:
            # Encrypt the API key at rest instead of storing plaintext
            encrypted_key = encrypt_sensitive(body.api_key) if body.api_key else ""
            user.ai_settings_json = json.dumps({
                "provider": body.provider,
                "api_key_encrypted": encrypted_key,
                "model": body.model or "",
                "base_url": body.base_url or "",
            })
            await session.commit()

    return {"message": "AI settings updated"}


@router.get("/settings")
async def get_ai_settings(
    current_user: User = Depends(get_current_user),
):
    """Get user's AI settings (without API key)."""
    from backend.services.encryption import decrypt_sensitive

    ai_settings: dict = {}
    if current_user.ai_settings_json:
        try:
            ai_settings = json.loads(current_user.ai_settings_json)
        except json.JSONDecodeError:
            pass

    # Determine if an API key exists (encrypted or legacy plaintext)
    has_key = False
    masked_key = ""
    if ai_settings.get("api_key_encrypted"):
        decrypted = decrypt_sensitive(ai_settings["api_key_encrypted"])
        if decrypted:
            has_key = True
            masked_key = f"{decrypted[:8]}...{decrypted[-4:]}" if len(decrypted) > 12 else "***"
    elif ai_settings.get("api_key"):
        key = ai_settings["api_key"]
        has_key = True
        masked_key = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"

    ai_settings["has_api_key"] = has_key
    if has_key:
        ai_settings["api_key_masked"] = masked_key

    # Never return the raw or encrypted key to the client
    ai_settings.pop("api_key", None)
    ai_settings.pop("api_key_encrypted", None)
    return ai_settings


# ---------------------------------------------------------------------------
# Feature toggle endpoints
# ---------------------------------------------------------------------------


@router.get("/features")
async def get_ai_features(
    current_user: User = Depends(get_current_user),
):
    """Get user's per-feature AI toggles."""
    return _get_user_features(current_user)


@router.put("/features")
async def update_ai_features(
    body: AIFeaturesUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update user's per-feature AI toggles."""
    # Validate feature names
    unknown = set(body.features.keys()) - AI_FEATURE_NAMES
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown AI feature(s): {', '.join(sorted(unknown))}",
        )

    # Merge with defaults so we always store a complete set
    merged = dict(_DEFAULT_FEATURES)
    merged.update(body.features)

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.id == current_user.id)
        )
        user = result.scalar_one_or_none()
        if user:
            user.ai_features_json = json.dumps({
                "enabled": body.enabled,
                "features": merged,
            })
            await session.commit()

    return {"enabled": body.enabled, "features": merged}
