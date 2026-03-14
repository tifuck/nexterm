"""Per-user known SSH host key model."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class KnownHost(Base):
    """Stores accepted SSH host key fingerprints per user.

    Analogous to ~/.ssh/known_hosts but scoped per-user in the database.
    """

    __tablename__ = "known_hosts"
    __table_args__ = (
        UniqueConstraint("user_id", "host", "port", "key_type", name="uq_known_host"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    key_type: Mapped[str] = mapped_column(String(50), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", backref="known_hosts")

    def __repr__(self):
        return f"<KnownHost {self.host}:{self.port} ({self.key_type})>"
