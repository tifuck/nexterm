"""Session request/response schemas."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from backend.models.session import SessionType


class SessionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    session_type: SessionType = Field(default=SessionType.SSH)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: Optional[str] = Field(None, max_length=255)
    # Client-side encrypted credential blobs (AES-256-GCM ciphertext, base64)
    encrypted_password: Optional[str] = None
    encrypted_ssh_key: Optional[str] = None
    encrypted_passphrase: Optional[str] = None
    folder_id: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7)
    icon: Optional[str] = Field(None, max_length=255)
    settings: Optional[str] = None  # JSON string
    protocol_settings: Optional[str] = None  # JSON string


class SessionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    session_type: Optional[SessionType] = None
    host: Optional[str] = Field(None, min_length=1, max_length=255)
    port: Optional[int] = Field(None, ge=1, le=65535)
    username: Optional[str] = Field(None, max_length=255)
    # Client-side encrypted credential blobs (AES-256-GCM ciphertext, base64)
    encrypted_password: Optional[str] = None
    encrypted_ssh_key: Optional[str] = None
    encrypted_passphrase: Optional[str] = None
    folder_id: Optional[str] = None
    color: Optional[str] = Field(None, max_length=7)
    icon: Optional[str] = Field(None, max_length=255)
    settings: Optional[str] = None
    protocol_settings: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    name: str
    session_type: SessionType
    host: str
    port: int
    username: Optional[str] = None
    folder_id: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0
    settings: Optional[str] = None
    protocol_settings: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_connected: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SessionCredentialsResponse(BaseModel):
    """Returns client-side encrypted credential blobs for a single session."""
    id: str
    encrypted_password: Optional[str] = None
    encrypted_ssh_key: Optional[str] = None
    encrypted_passphrase: Optional[str] = None


class SessionConnectRequest(BaseModel):
    password: Optional[str] = None
    ssh_key: Optional[str] = None
    passphrase: Optional[str] = None


class QuickConnectRequest(BaseModel):
    session_type: SessionType = Field(default=SessionType.SSH)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: Optional[str] = Field(None, max_length=255)
    password: Optional[str] = None
    ssh_key: Optional[str] = None
