"""
Authentication module for Gorgonetics.

Provides JWT-based authentication and authorization for multiuser support.
"""

from .models import User, UserCreate, UserLogin, Token
from .utils import create_access_token, verify_password, get_password_hash
from .dependencies import get_current_user, get_current_active_user, require_admin

__all__ = [
    "User",
    "UserCreate", 
    "UserLogin",
    "Token",
    "create_access_token",
    "verify_password",
    "get_password_hash",
    "get_current_user",
    "get_current_active_user",
    "require_admin",
]