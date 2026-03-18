"""Session import request/response schemas."""
from typing import Optional

from pydantic import BaseModel, Field


class ImportedSession(BaseModel):
    """A single parsed session from an import file."""
    name: str = Field(..., min_length=1, max_length=255)
    session_type: str = Field(default="ssh", max_length=10)
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: Optional[str] = Field(default=None, max_length=255)
    folder_path: Optional[str] = Field(default=None, max_length=1024)  # e.g. "Production/Web Servers"


class ImportResult(BaseModel):
    """Result of an import operation."""
    sessions_created: int = 0
    folders_created: int = 0
    skipped: int = 0
    warnings: list[str] = Field(default_factory=list)
    sessions: list[ImportedSession] = Field(default_factory=list)


class ImportPreview(BaseModel):
    """Preview of sessions parsed from a file before committing."""
    format_detected: str
    sessions: list[ImportedSession] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
