"""AI assistance endpoints."""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.middleware.auth import get_current_user
from backend.models.user import User
from backend.config import config

logger = logging.getLogger(__name__)

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


async def get_ai_client(user: User):
    """Get the AI client based on user's settings."""
    if not config.ai_enabled:
        raise HTTPException(status_code=403, detail="AI features are disabled")
    
    ai_settings = {}
    if user.ai_settings_json:
        try:
            ai_settings = json.loads(user.ai_settings_json)
        except json.JSONDecodeError:
            pass
    
    provider = ai_settings.get("provider", "")
    api_key = ai_settings.get("api_key", "")
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
    settings = await get_ai_client(current_user)
    result = await call_ai(settings, EXPLAIN_SYSTEM_PROMPT, request.command)
    return {"explanation": result.strip()}


@router.put("/settings")
async def update_ai_settings(
    settings: AISettingsUpdate,
    current_user: User = Depends(get_current_user),
    db=Depends(lambda: None),  # placeholder
):
    """Update user's AI provider settings."""
    from backend.database import get_db, async_session_factory
    
    async with async_session_factory() as session:
        from sqlalchemy import select
        result = await session.execute(
            select(User).where(User.id == current_user.id)
        )
        user = result.scalar_one_or_none()
        if user:
            user.ai_settings_json = json.dumps({
                "provider": settings.provider,
                "api_key": settings.api_key or "",
                "model": settings.model or "",
                "base_url": settings.base_url or "",
            })
            await session.commit()
    
    return {"message": "AI settings updated"}


@router.get("/settings")
async def get_ai_settings(
    current_user: User = Depends(get_current_user),
):
    """Get user's AI settings (without API key)."""
    ai_settings = {}
    if current_user.ai_settings_json:
        try:
            ai_settings = json.loads(current_user.ai_settings_json)
        except json.JSONDecodeError:
            pass
    
    # Mask API key
    if ai_settings.get("api_key"):
        key = ai_settings["api_key"]
        ai_settings["api_key_masked"] = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "***"
        ai_settings["has_api_key"] = True
    else:
        ai_settings["has_api_key"] = False
    
    ai_settings.pop("api_key", None)
    return ai_settings
