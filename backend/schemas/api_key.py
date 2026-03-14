from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ApiKeyPermissions(BaseModel):
    read_sessions: bool = False
    write_sessions: bool = False
    connect: bool = False
    admin: bool = False


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    permissions: ApiKeyPermissions
    expires_at: Optional[datetime] = None


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    permissions: ApiKeyPermissions
    is_active: bool = True
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_used: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ApiKeyCreatedResponse(ApiKeyResponse):
    key: str = Field(..., description="Full API key, shown only once at creation time")
