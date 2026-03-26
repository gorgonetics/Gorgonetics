"""FastAPI dependencies for authentication and authorization."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from gorgonetics.auth.models import User, UserCreate, UserInDB
from gorgonetics.auth.utils import verify_token
from gorgonetics.constants import UserRole
from gorgonetics.database_config import create_auth_database_instance

# HTTP Bearer token scheme
security = HTTPBearer()


def _fetch_active_user(username: str) -> User | None:
    """Look up an active user by username, returning None if not found."""
    auth_db = create_auth_database_instance()
    try:
        return auth_db.get_active_user_by_username(username)
    except Exception:
        return None
    finally:
        auth_db.close()


def get_current_user(credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]) -> User:
    """Get current authenticated user from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = verify_token(credentials.credentials, "access")
    if token_data is None or token_data.username is None:
        raise credentials_exception

    user = _fetch_active_user(token_data.username)
    if user is None:
        raise credentials_exception
    return user


def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Get current user and verify they are active."""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user")
    return current_user


def get_optional_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))],
) -> User | None:
    """Get current authenticated user from JWT token, returns None if not authenticated."""
    if not credentials:
        return None

    try:
        token_data = verify_token(credentials.credentials, "access")
        if token_data is None or token_data.username is None:
            return None
        return _fetch_active_user(token_data.username)
    except Exception:
        return None


def require_admin(current_user: Annotated[User, Depends(get_current_active_user)]) -> User:
    """Require current user to have admin role."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions. Admin role required."
        )
    return current_user


def get_user_by_username(username: str) -> UserInDB | None:
    """Get user by username from database (includes password hash)."""
    auth_db = create_auth_database_instance()
    try:
        return auth_db.get_user_by_username(username)
    except Exception:
        return None
    finally:
        auth_db.close()


def create_user_in_db(user_create: "UserCreate", password_hash: str, role: UserRole = UserRole.USER) -> User:
    """Create a new user in the database."""
    auth_db = create_auth_database_instance()
    try:
        return auth_db.create_user(user_create.username, password_hash, role=role)
    except Exception as e:
        raise Exception(f"Failed to create user: {e}") from e
    finally:
        auth_db.close()
