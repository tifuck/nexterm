"""Revoked JWT token model for persistent token blocklisting."""

import hashlib
from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class RevokedToken(Base):
    """Stores hashed revoked tokens so they survive server restarts.

    Only the SHA-256 hash of the raw JWT is stored to avoid keeping
    sensitive token material in the database.  Rows are automatically
    purged once their ``expires_at`` timestamp is in the past.
    """

    __tablename__ = "revoked_tokens"

    token_hash: Mapped[str] = mapped_column(
        String(64), primary_key=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
    )

    @staticmethod
    def hash_token(raw_token: str) -> str:
        """Return the SHA-256 hex digest of a raw JWT string."""
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    def __repr__(self) -> str:
        return f"<RevokedToken {self.token_hash[:12]}… exp={self.expires_at}>"
