"""Self-signed certificate generation utility."""

import datetime
import os
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def generate_self_signed_cert(
    cert_path: str,
    key_path: str,
    hostname: str = "localhost",
    days: int = 365,
) -> None:
    """Generate a self-signed TLS certificate and private key.

    Creates an RSA 2048-bit key pair and an X.509 certificate with
    Subject Alternative Names for localhost, 127.0.0.1, and the
    given hostname.

    Args:
        cert_path: File path to write the PEM-encoded certificate.
        key_path: File path to write the PEM-encoded private key.
        hostname: Common Name and SAN hostname (default "localhost").
        days: Certificate validity period in days (default 365).
    """
    cert_path = Path(cert_path)
    key_path = Path(key_path)

    # Create parent directories if needed
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    # Generate RSA 2048 private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Build Subject Alternative Names
    san_names = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress_from_string("127.0.0.1")),
    ]
    if hostname != "localhost":
        san_names.insert(0, x509.DNSName(hostname))

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, hostname),
    ])

    now = datetime.datetime.now(datetime.timezone.utc)

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=days))
        .add_extension(
            x509.SubjectAlternativeName(san_names),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    # Write private key with restrictive permissions (owner-only read/write)
    key_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_path.write_bytes(key_bytes)
    os.chmod(str(key_path), 0o600)

    # Write certificate
    cert_path.write_bytes(
        cert.public_bytes(serialization.Encoding.PEM)
    )


def ipaddress_from_string(addr: str):
    """Convert an IP address string to an ipaddress object.

    Args:
        addr: IP address string (e.g. "127.0.0.1").

    Returns:
        An IPv4Address or IPv6Address instance.
    """
    import ipaddress
    return ipaddress.ip_address(addr)
