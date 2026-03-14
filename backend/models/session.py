"""Saved session model for SSH, RDP, VNC, Telnet, FTP connections."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum


from backend.database import Base


class SessionType(str, enum.Enum):
    SSH = "ssh"
    RDP = "rdp"
    VNC = "vnc"
    TELNET = "telnet"
    FTP = "ftp"
    SFTP = "sftp"


class SavedSession(Base):
    __tablename__ = "saved_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Connection details
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    session_type: Mapped[SessionType] = mapped_column(
        Enum(SessionType), nullable=False, default=SessionType.SSH
    )
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=22)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Encrypted credentials (client-side AES-256-GCM, stored as opaque base64 blobs)
    encrypted_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_ssh_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    encrypted_passphrase: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Display settings
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # Hex color
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # Per-session settings (JSON): terminal_theme, font, cursor_style, etc.
    settings_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Protocol-specific settings (JSON): rdp_resolution, vnc_color_depth, etc.
    protocol_settings_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    last_connected: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="sessions")
    folder = relationship("Folder", back_populates="sessions")

    def __repr__(self):
        return f"<SavedSession {self.name} ({self.session_type.value})>"
