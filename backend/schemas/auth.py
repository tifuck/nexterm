from datetime import datetime
import re
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.services.auth_security import normalize_email, normalize_username, validate_username


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=1, max_length=1024)

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str) -> str:
        return normalize_username(v)


def _validate_password_strength(password: str) -> str:
    """Enforce password complexity requirements.

    Rules:
      - Minimum 8 characters (enforced by Pydantic min_length).
      - At least one uppercase letter.
      - At least one lowercase letter.
      - At least one digit.
    """
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one digit")
    return password


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=255)
    email: Optional[str] = Field(None, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    password_confirm: str = Field(..., min_length=8, max_length=128)
    website: str = Field(default="", max_length=0)

    @field_validator("username")
    @classmethod
    def username_format(cls, v: str) -> str:
        return validate_username(v)

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: Optional[str]) -> Optional[str]:
        return normalize_email(v)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @field_validator("password_confirm")
    @classmethod
    def passwords_match(cls, v: str, info: Any) -> str:
        if "password" in info.data and v != info.data["password"]:
            raise ValueError("Passwords do not match")
        return v


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    encryption_salt: str = Field(..., description="Per-user PBKDF2 salt for client-side E2EE key derivation")


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=1024)
    new_password: str = Field(..., min_length=8, max_length=128)
    new_password_confirm: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def new_password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)

    @field_validator("new_password_confirm")
    @classmethod
    def passwords_match(cls, v: str, info: Any) -> str:
        if "new_password" in info.data and v != info.data["new_password"]:
            raise ValueError("Passwords do not match")
        return v


class ChangePasswordResponse(BaseModel):
    encryption_salt: str = Field(..., description="New PBKDF2 salt — re-derive the client-side key")


class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    role: str = "user"
    is_active: bool = True
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None
    settings: dict[str, Any] = Field(default_factory=dict)
    encryption_salt: str = ""

    model_config = {"from_attributes": True}
