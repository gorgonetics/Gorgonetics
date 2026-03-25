"""
FastAPI dependencies for authentication and authorization.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from gorgonetics.auth.models import User, UserCreate, UserInDB
from gorgonetics.auth.utils import verify_token
from gorgonetics.constants import UserRole
from gorgonetics.database_config import create_database_instance

# HTTP Bearer token scheme
security = HTTPBearer()


def _user_from_row(row: tuple) -> User:
    """Convert a (id, username, role, is_active, created_at, updated_at) row to a User."""
    return User(id=row[0], username=row[1], role=row[2], is_active=row[3], created_at=row[4], updated_at=row[5])


def _user_in_db_from_row(row: tuple) -> UserInDB:
    """Convert a (id, username, password_hash, role, is_active, created_at, updated_at) row to a UserInDB."""
    return UserInDB(
        id=row[0],
        username=row[1],
        password_hash=row[2],
        role=row[3],
        is_active=row[4],
        created_at=row[5],
        updated_at=row[6],
    )


def _fetch_active_user(username: str) -> User | None:
    """Look up an active user by username, returning None if not found."""
    db = create_database_instance()
    try:
        assert db.conn is not None
        row = db.conn.execute(
            "SELECT id, username, role, is_active, created_at, updated_at FROM users WHERE username = $username AND is_active = true",
            {"username": username},
        ).fetchone()
        return _user_from_row(row) if row else None
    except Exception:
        return None
    finally:
        db.close()


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
    """
    Get current user and verify they are active.

    Args:
        current_user: Current authenticated user

    Returns:
        Active user data

    Raises:
        HTTPException: If user is inactive
    """
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
    """
    Require current user to have admin role.

    Args:
        current_user: Current authenticated user

    Returns:
        Admin user data

    Raises:
        HTTPException: If user is not admin
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions. Admin role required."
        )
    return current_user


def get_user_by_username(username: str) -> UserInDB | None:
    """Get user by username from database (includes password hash)."""
    db = create_database_instance()
    try:
        assert db.conn is not None
        row = db.conn.execute(
            "SELECT id, username, password_hash, role, is_active, created_at, updated_at FROM users WHERE username = $username",
            {"username": username},
        ).fetchone()
        return _user_in_db_from_row(row) if row else None
    except Exception:
        return None
    finally:
        db.close()


def create_user_in_db(user_create: "UserCreate", password_hash: str, role: UserRole = UserRole.USER) -> User:
    """Create a new user in the database."""
    from datetime import datetime

    db = create_database_instance()
    try:
        now = datetime.now()
        assert db.conn is not None
        result = db.conn.execute("SELECT MAX(id) FROM users").fetchone()
        assert result is not None
        next_id = (result[0] or 0) + 1

        db.conn.execute(
            """INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
               VALUES ($id, $username, $password_hash, $role, $is_active, $created_at, $updated_at)""",
            {
                "id": next_id,
                "username": user_create.username,
                "password_hash": password_hash,
                "role": role,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            },
        )

        row = db.conn.execute(
            "SELECT id, username, role, is_active, created_at, updated_at FROM users WHERE username = $username",
            {"username": user_create.username},
        ).fetchone()

        if row is None:
            raise Exception("Failed to create user")

        return _user_from_row(row)

    except Exception as e:
        raise Exception(f"Failed to create user: {e}") from e
    finally:
        db.close()
