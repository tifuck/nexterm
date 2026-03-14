"""Credential encryption service using Fernet symmetric encryption."""

import base64
import hashlib
import logging
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)


def derive_key(password: str, salt: bytes, iterations: int = 600000) -> bytes:
    """Derive a Fernet-compatible key from a user password using PBKDF2HMAC.

    Args:
        password: The user's password.
        salt: Random salt bytes.
        iterations: Number of PBKDF2 iterations (default 600000).

    Returns:
        A base64url-encoded 32-byte key suitable for Fernet.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    raw_key = kdf.derive(password.encode("utf-8"))
    return base64.urlsafe_b64encode(raw_key)


def encrypt_value(value: str, key: bytes) -> str:
    """Encrypt a string value using Fernet.

    Args:
        value: Plaintext string to encrypt.
        key: Fernet-compatible key (base64url-encoded 32 bytes).

    Returns:
        Base64-encoded ciphertext string.
    """
    f = Fernet(key)
    token = f.encrypt(value.encode("utf-8"))
    return base64.b64encode(token).decode("utf-8")


def decrypt_value(encrypted: str, key: bytes) -> str:
    """Decrypt a base64-encoded ciphertext string.

    Args:
        encrypted: Base64-encoded ciphertext.
        key: Fernet-compatible key (base64url-encoded 32 bytes).

    Returns:
        Decrypted plaintext string.
    """
    f = Fernet(key)
    token = base64.b64decode(encrypted.encode("utf-8"))
    return f.decrypt(token).decode("utf-8")


def generate_salt() -> bytes:
    """Generate a cryptographically secure random 16-byte salt.

    Returns:
        16 bytes of random data.
    """
    return os.urandom(16)


class EncryptionService:
    """Stateful encryption service that stores a derived key for
    convenient encrypt/decrypt operations."""

    def __init__(self, key: bytes):
        """Initialize with a Fernet-compatible key.

        Args:
            key: Base64url-encoded 32-byte key from derive_key().
        """
        self._key = key
        self._fernet = Fernet(key)

    @classmethod
    def from_password(cls, password: str, salt: bytes, iterations: int = 600000) -> "EncryptionService":
        """Create an EncryptionService by deriving a key from a password.

        Args:
            password: The user's password.
            salt: Random salt bytes.
            iterations: PBKDF2 iteration count.

        Returns:
            An initialized EncryptionService instance.
        """
        key = derive_key(password, salt, iterations)
        return cls(key)

    def encrypt(self, value: str) -> str:
        """Encrypt a plaintext string.

        Args:
            value: The string to encrypt.

        Returns:
            Base64-encoded ciphertext.
        """
        return encrypt_value(value, self._key)

    def decrypt(self, encrypted: str) -> str:
        """Decrypt a ciphertext string.

        Args:
            encrypted: Base64-encoded ciphertext.

        Returns:
            Decrypted plaintext string.
        """
        return decrypt_value(encrypted, self._key)


# ---------------------------------------------------------------------------
# Module-level singleton (lazy-initialised from app secret_key)
# ---------------------------------------------------------------------------

_service: EncryptionService | None = None


def get_encryption_service() -> EncryptionService:
    """Return (and lazily create) the app-wide EncryptionService.

    The Fernet key is derived from ``config.secret_key`` using PBKDF2 with a
    deterministic salt (SHA-256 of the secret key).  This is stable across
    restarts as long as the secret key in *config.yaml* stays the same.
    """
    global _service
    if _service is not None:
        return _service

    from backend.config import config

    secret = config.secret_key
    # Deterministic 16-byte salt so we always derive the same key.
    salt = hashlib.sha256(secret.encode("utf-8")).digest()[:16]
    _service = EncryptionService.from_password(
        secret, salt, iterations=config.kdf_iterations,
    )
    return _service


def encrypt_sensitive(value: str | None) -> str | None:
    """Encrypt a plaintext credential string for storage.

    Returns *None* unchanged so callers don't need a guard.
    """
    if value is None:
        return None
    return get_encryption_service().encrypt(value)


def decrypt_sensitive(stored: str | None) -> str | None:
    """Decrypt a stored credential string.

    Handles two formats transparently:
    1. Fernet-encrypted (current) – preferred path.
    2. Legacy plain base64 (MVP placeholder) – auto-detected when Fernet
       decryption raises ``InvalidToken``.

    Returns *None* unchanged.
    """
    if stored is None:
        return None
    svc = get_encryption_service()
    try:
        return svc.decrypt(stored)
    except (InvalidToken, Exception):
        # Fallback: legacy base64-only encoding from the MVP placeholder.
        try:
            return base64.b64decode(stored.encode("utf-8")).decode("utf-8")
        except Exception:
            logger.warning("Failed to decrypt credential value; returning None")
            return None
