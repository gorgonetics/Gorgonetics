"""
Authentication models for user management.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from ..constants import UserRole


class UserBase(BaseModel):
    """Base user model with common fields."""

    username: str = Field(..., min_length=3, max_length=50)


class UserCreate(UserBase):
    """Model for user registration."""

    password: str = Field(..., min_length=8, max_length=128)


class UserLogin(BaseModel):
    """Model for user login credentials."""

    username: str
    password: str


class User(UserBase):
    """User model for API responses (no password)."""

    id: int
    role: str = UserRole.USER
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserInDB(User):
    """User model as stored in database (with password hash)."""

    password_hash: str


class Token(BaseModel):
    """JWT token response model."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int  # seconds


class TokenData(BaseModel):
    """Token payload data."""

    username: str | None = None
    user_id: int | None = None
    role: str | None = None
