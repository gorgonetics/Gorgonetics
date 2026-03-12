"""
Authentication utilities for password hashing and JWT token management.
"""

import os
import sys
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
from jose import JWTError, jwt

from gorgonetics.auth.models import TokenData

# JWT settings
SECRET_KEY = os.getenv("GORGONETICS_JWT_SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("GORGONETICS_JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("GORGONETICS_JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Refuse to start in production mode with a weak secret
_WEAK_SECRETS = {
    "your-secret-key-change-this-in-production",
    "dev-secret-key-not-for-production",
    "dev-secret-key-not-for-production-change-this",
    "",
}
if os.getenv("GORGONETICS_ENV", "development") == "production" and SECRET_KEY in _WEAK_SECRETS:
    print(
        "FATAL: GORGONETICS_JWT_SECRET_KEY must be set to a strong, unique secret in production. "
        'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"',
        file=sys.stderr,
    )
    sys.exit(1)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against its hash."""
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    """Generate password hash from plaintext password."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Create JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Create JWT refresh token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str, token_type: str = "access") -> TokenData | None:
    """
    Verify JWT token and return token data.

    Args:
        token: JWT token string
        token_type: Expected token type ("access" or "refresh")

    Returns:
        TokenData if valid, None if invalid
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        # Check token type
        if payload.get("type") != token_type:
            return None

        username = payload.get("sub")
        user_id = payload.get("user_id")
        role = payload.get("role")

        if username is None or user_id is None:
            return None

        return TokenData(username=username, user_id=user_id, role=role)

    except JWTError:
        return None


def create_token_pair(user_data: dict[str, Any]) -> dict[str, Any]:
    """
    Create both access and refresh tokens for a user.

    Args:
        user_data: Dict with user info (sub, user_id, role)

    Returns:
        Dict with access_token, refresh_token, and metadata
    """
    access_token = create_access_token(user_data)
    refresh_token = create_refresh_token(user_data)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # Convert to seconds
    }
