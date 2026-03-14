"""Session import request/response schemas."""
from typing import Optional

from pydantic import BaseModel, Field


class ImportedSession(BaseModel):
    """A single parsed session from an import file."""
    name: str
    session_type: str = "ssh"
    host: str
    port: int = 22
    username: Optional[str] = None
    folder_path: Optional[str] = None  # e.g. "Production/Web Servers"


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
