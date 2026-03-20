"""Shared AI provider and feature-toggle helpers."""
import ipaddress
import json
import logging
from urllib.parse import urlparse

from fastapi import HTTPException

from backend.config import config
from backend.models.user import User
from backend.services.encryption import decrypt_sensitive

logger = logging.getLogger(__name__)

AI_FEATURE_NAMES = {
    "command_generation",
    "error_diagnosis",
    "command_explanation",
    "log_analysis",
}

AI_PROVIDER_NAMES = {"openai", "anthropic", "ollama"}

DEFAULT_AI_FEATURES = {name: True for name in AI_FEATURE_NAMES}

COMMAND_SYSTEM_PROMPT = """You are a Linux/Unix command-line assistant.

Given a user goal, return shell command(s) only.

Rules:
- Return ONLY executable command text (no markdown, no prose)
- Prefer safe, reversible, and read-only commands first when intent is ambiguous
- Use portable commands where practical
- If multiple steps are required, separate with && or newlines
- Respect provided context and recent commands when useful
- Never include fake placeholders like <file>; infer practical defaults"""

DIAGNOSE_SYSTEM_PROMPT = """You are a Linux/Unix production troubleshooting assistant.

Analyze terminal error output and return this exact structure:
**Problem:** one concise sentence
**Likely cause:** one concise sentence
**Fix:** concrete command(s) or action steps the user can run now
**Verify:** one command to confirm the fix worked

Keep it practical and avoid generic advice."""

EXPLAIN_SYSTEM_PROMPT = """You are a Linux/Unix command tutor.

Explain what the command does in concise, practical language:
- One short overview sentence
- Brief breakdown of key flags/arguments
- Mention side effects and whether it is potentially destructive"""

_ALLOWED_OLLAMA_HOSTS = {"localhost", "127.0.0.1", "::1"}


def validate_ollama_url(url: str) -> None:
    """Reject Ollama URLs that could cause SSRF to sensitive endpoints."""
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

    if hostname in _ALLOWED_OLLAMA_HOSTS:
        return

    if hostname and "." not in hostname and hostname.replace("-", "").isalnum():
        return

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

    raise HTTPException(
        status_code=400,
        detail="Ollama URL must point to localhost or a private network address",
    )


def parse_ai_settings(user: User) -> dict[str, str]:
    """Return normalized AI settings with decrypted API key."""
    ai_settings: dict[str, str] = {}
    if user.ai_settings_json:
        try:
            ai_settings = json.loads(user.ai_settings_json)
        except json.JSONDecodeError:
            ai_settings = {}

    provider = (ai_settings.get("provider") or "").strip().lower()
    api_key = ""
    if ai_settings.get("api_key_encrypted"):
        api_key = decrypt_sensitive(ai_settings["api_key_encrypted"]) or ""
    elif ai_settings.get("api_key"):
        api_key = ai_settings["api_key"]

    model = (ai_settings.get("model") or "").strip()
    base_url = (ai_settings.get("base_url") or "").strip()

    return {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
    }


def is_provider_configured(settings: dict[str, str]) -> bool:
    """Return True when provider settings are usable for API calls."""
    provider = settings.get("provider", "")
    if not provider:
        return False
    if provider in {"openai", "anthropic"}:
        return bool(settings.get("api_key"))
    if provider == "ollama":
        return True
    return False


async def get_ai_client(user: User) -> dict[str, str]:
    """Get validated AI provider settings for the current user."""
    if not config.ai_enabled:
        raise HTTPException(status_code=403, detail="AI features are disabled")

    settings = parse_ai_settings(user)
    provider = settings["provider"]

    if not provider:
        raise HTTPException(
            status_code=400,
            detail="AI provider not configured. Go to Settings > AI to set up.",
        )

    if provider not in AI_PROVIDER_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown AI provider: {provider}")

    if provider in {"openai", "anthropic"} and not settings["api_key"]:
        raise HTTPException(
            status_code=400,
            detail=f"{provider.title()} API key missing. Set it in Settings > AI.",
        )

    if provider == "ollama":
        validate_ollama_url(settings["base_url"] or "http://localhost:11434")

    return settings


async def call_ai(settings: dict[str, str], system_prompt: str, user_prompt: str) -> str:
    """Call the configured AI provider and return plain text output."""
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
                temperature=0.2,
            )
            return (response.choices[0].message.content or "").strip()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAI error: {e}")

    if provider == "anthropic":
        try:
            from anthropic import AsyncAnthropic

            client = AsyncAnthropic(api_key=settings["api_key"])
            response = await client.messages.create(
                model=settings.get("model") or "claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            if not response.content:
                return ""
            text_parts: list[str] = []
            for block in response.content:
                block_text = getattr(block, "text", None)
                if block_text:
                    text_parts.append(block_text)
            return "\n".join(text_parts).strip()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Anthropic error: {e}")

    if provider == "ollama":
        try:
            import httpx

            base_url = settings.get("base_url") or "http://localhost:11434"
            validate_ollama_url(base_url)
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
                response.raise_for_status()
                data = response.json()
                return (data.get("message", {}).get("content", "") or "").strip()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Ollama error: {e}")

    raise HTTPException(status_code=400, detail=f"Unknown AI provider: {provider}")


def get_user_features(user: User) -> dict:
    """Parse per-user AI feature toggles and merge with defaults."""
    result = {"enabled": True, "features": dict(DEFAULT_AI_FEATURES)}
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
    """Raise 403 when AI is disabled globally, per-user, or per-feature."""
    if not config.ai_enabled:
        raise HTTPException(
            status_code=403,
            detail="AI features are disabled by the administrator",
        )

    feat = get_user_features(user)
    if not feat["enabled"]:
        raise HTTPException(status_code=403, detail="AI is disabled in your settings")

    if not feat["features"].get(feature_name, True):
        raise HTTPException(
            status_code=403,
            detail=f"The '{feature_name}' AI feature is disabled in your settings",
        )
