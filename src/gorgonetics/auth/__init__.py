"""
Authentication module for Gorgonetics.

Provides JWT-based authentication and authorization for multiuser support.
"""

from .dependencies import get_current_active_user, get_current_user, get_optional_current_user, require_admin
from .models import Token, User, UserCreate, UserLogin
from .utils import create_access_token, create_token_pair, get_password_hash, verify_password

__all__ = [
    "User",
    "UserCreate",
    "UserLogin",
    "Token",
    "create_access_token",
    "create_token_pair",
    "verify_password",
    "get_password_hash",
    "get_current_user",
    "get_current_active_user",
    "get_optional_current_user",
    "require_admin",
]
