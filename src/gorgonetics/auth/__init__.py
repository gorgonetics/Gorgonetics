"""
Authentication module for Gorgonetics.

Provides JWT-based authentication and authorization for multiuser support.
"""

from gorgonetics.auth.dependencies import (
    get_current_active_user,
    get_current_user,
    get_optional_current_user,
    require_admin,
)
from gorgonetics.auth.models import Token, User, UserCreate, UserLogin
from gorgonetics.auth.utils import create_access_token, create_token_pair, get_password_hash, verify_password, verify_token

__all__ = [
    "User",
    "UserCreate",
    "UserLogin",
    "Token",
    "create_access_token",
    "create_token_pair",
    "verify_password",
    "verify_token",
    "get_password_hash",
    "get_current_user",
    "get_current_active_user",
    "get_optional_current_user",
    "require_admin",
]
