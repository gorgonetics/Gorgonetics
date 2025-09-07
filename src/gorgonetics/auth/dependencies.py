"""
FastAPI dependencies for authentication and authorization.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..database_config import create_database_instance
from .models import User, UserInDB
from .utils import verify_token

# HTTP Bearer token scheme
security = HTTPBearer()


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]
) -> User:
    """
    Get current authenticated user from JWT token.
    
    Args:
        credentials: Bearer token from Authorization header
        
    Returns:
        Current user data
        
    Raises:
        HTTPException: If token is invalid or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # Verify token
    token_data = verify_token(credentials.credentials, "access")
    if token_data is None or token_data.username is None:
        raise credentials_exception
    
    # Get user from database
    db = create_database_instance()
    try:
        user_data = db.conn.execute(
            "SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE username = ? AND is_active = true",
            (token_data.username,)
        ).fetchone()
        
        if user_data is None:
            raise credentials_exception
            
        # Convert to User model
        user = User(
            id=user_data[0],
            username=user_data[1],
            email=user_data[2], 
            role=user_data[3],
            is_active=user_data[4],
            created_at=user_data[5],
            updated_at=user_data[6]
        )
        
        return user
        
    except Exception as e:
        raise credentials_exception from e
    finally:
        db.close()


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
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


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
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions. Admin role required."
        )
    return current_user


def get_user_by_username(username: str) -> UserInDB | None:
    """
    Get user by username from database.
    
    Args:
        username: Username to search for
        
    Returns:
        User data with password hash, or None if not found
    """
    db = create_database_instance()
    try:
        user_data = db.conn.execute(
            "SELECT id, username, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE username = ?",
            (username,)
        ).fetchone()
        
        if user_data is None:
            return None
            
        return UserInDB(
            id=user_data[0],
            username=user_data[1],
            email=user_data[2],
            password_hash=user_data[3],
            role=user_data[4],
            is_active=user_data[5],
            created_at=user_data[6],
            updated_at=user_data[7]
        )
        
    except Exception:
        return None
    finally:
        db.close()


def create_user_in_db(user_create: "UserCreate", password_hash: str) -> User:
    """
    Create a new user in the database.
    
    Args:
        user_create: User creation data
        password_hash: Hashed password
        
    Returns:
        Created user data
        
    Raises:
        Exception: If user creation fails
    """
    from .models import UserCreate  # Import here to avoid circular import
    
    db = create_database_instance()
    try:
        # Insert new user
        db.conn.execute(
            """INSERT INTO users (username, email, password_hash, role, is_active, created_at, updated_at)
               VALUES (?, ?, ?, 'user', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (user_create.username, user_create.email, password_hash)
        )
        
        # Get the created user
        user_data = db.conn.execute(
            "SELECT id, username, email, role, is_active, created_at, updated_at FROM users WHERE username = ?",
            (user_create.username,)
        ).fetchone()
        
        if user_data is None:
            raise Exception("Failed to create user")
            
        return User(
            id=user_data[0],
            username=user_data[1],
            email=user_data[2],
            role=user_data[3],
            is_active=user_data[4],
            created_at=user_data[5],
            updated_at=user_data[6]
        )
        
    except Exception as e:
        raise Exception(f"Failed to create user: {e}") from e
    finally:
        db.close()