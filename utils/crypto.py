"""
crypto.py — AES-256-GCM encryption helpers for sensitive profile fields.

The encryption key is read from the PROFILE_ENCRYPTION_KEY environment variable,
which must be a 64-character hex string (32 bytes).

Generate one with:
    python -c "import secrets; print(secrets.token_hex(32))"

Encrypted values are stored as base64(nonce + ciphertext + tag) — a single
opaque string safe to put in a TEXT column.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _load_key() -> bytes:
    raw = os.environ.get("PROFILE_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("PROFILE_ENCRYPTION_KEY environment variable is not set.")
    try:
        key = bytes.fromhex(raw)
    except ValueError:
        raise RuntimeError("PROFILE_ENCRYPTION_KEY must be a 64-character hex string.")
    if len(key) != 32:
        raise RuntimeError("PROFILE_ENCRYPTION_KEY must decode to exactly 32 bytes.")
    return key


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return a base64-encoded nonce+ciphertext blob."""
    key = _load_key()
    nonce = os.urandom(12)  # 96-bit nonce recommended for AES-GCM
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt(blob: str) -> str:
    """Decrypt a base64-encoded nonce+ciphertext blob and return the plaintext."""
    key = _load_key()
    raw = base64.b64decode(blob)
    nonce, ciphertext = raw[:12], raw[12:]
    return AESGCM(key).decrypt(nonce, ciphertext, None).decode()
