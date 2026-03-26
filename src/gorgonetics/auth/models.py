"""
Authentication models for user management.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from gorgonetics.constants import UserRole


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

    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str = UserRole.USER
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class UserInDB(User):
    """User model as stored in database (with password hash)."""

    password_hash: str


class Token(BaseModel):
    """JWT token response model."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserUpdate(BaseModel):
    """Model for admin user updates (partial)."""

    role: UserRole | None = None
    is_active: bool | None = None


class TokenData(BaseModel):
    """Token payload data."""

    username: str | None = None
    user_id: int | None = None
    role: str | None = None
