"""
Integration tests for authentication endpoints.

Covers registration, login, /me, logout, and token refresh flows.
"""

from collections.abc import Generator
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from gorgonetics.web_app import app

if TYPE_CHECKING:
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase


@pytest.fixture(scope="function")
def auth_client(test_database: "DuckLakeGeneDatabase") -> Generator[TestClient]:
    """Plain TestClient using test database — no auth headers pre-applied."""
    test_client = TestClient(app)
    yield test_client


class TestAuthRegister:
    """Test POST /api/auth/register."""

    def test_register_valid_user(self, auth_client: TestClient, test_database: "DuckLakeGeneDatabase") -> None:
        """Registering with valid credentials returns user data."""
        response = auth_client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "password123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "newuser"
        assert data["role"] == "user"
        assert data["is_active"] is True
        assert "password" not in data
        assert "password_hash" not in data
        # Clean up
        test_database.conn.execute("DELETE FROM users WHERE username = 'newuser'")

    def test_register_duplicate_username(self, auth_client: TestClient, test_database: "DuckLakeGeneDatabase") -> None:
        """Registering a username that already exists returns 400."""
        auth_client.post("/api/auth/register", json={"username": "dupuser", "password": "password123"})
        response = auth_client.post("/api/auth/register", json={"username": "dupuser", "password": "password456"})
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"]
        # Clean up
        test_database.conn.execute("DELETE FROM users WHERE username = 'dupuser'")

    def test_register_short_password(self, auth_client: TestClient) -> None:
        """Passwords shorter than 8 characters are rejected (Pydantic validation)."""
        response = auth_client.post("/api/auth/register", json={"username": "shortpwuser", "password": "abc"})
        assert response.status_code == 422

    def test_register_short_username(self, auth_client: TestClient) -> None:
        """Usernames shorter than 3 characters are rejected (Pydantic validation)."""
        response = auth_client.post("/api/auth/register", json={"username": "ab", "password": "validpassword"})
        assert response.status_code == 422

    def test_register_missing_fields(self, auth_client: TestClient) -> None:
        """Omitting required fields returns 422."""
        response = auth_client.post("/api/auth/register", json={"username": "nopassword"})
        assert response.status_code == 422


class TestAuthLogin:
    """Test POST /api/auth/login."""

    @pytest.fixture(autouse=True)
    def _create_login_user(self, test_database: "DuckLakeGeneDatabase") -> Generator[None]:
        """Insert a test user for login tests."""
        from datetime import datetime

        from gorgonetics.auth.utils import get_password_hash
        from gorgonetics.constants import UserRole

        password_hash = get_password_hash("loginpassword")
        now = datetime.now()
        result = test_database.conn.execute("SELECT MAX(id) FROM users").fetchone()
        next_id = (result[0] or 0) + 1
        test_database.conn.execute(
            "INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (next_id, "loginuser", password_hash, UserRole.USER, True, now, now),
        )
        yield
        test_database.conn.execute("DELETE FROM users WHERE username = 'loginuser'")

    def test_login_valid_credentials(self, auth_client: TestClient) -> None:
        """Login with correct credentials returns access and refresh tokens."""
        response = auth_client.post("/api/auth/login", json={"username": "loginuser", "password": "loginpassword"})
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data

    def test_login_wrong_password(self, auth_client: TestClient) -> None:
        """Wrong password returns 401."""
        response = auth_client.post("/api/auth/login", json={"username": "loginuser", "password": "wrongpassword"})
        assert response.status_code == 401
        assert "Incorrect" in response.json()["detail"]

    def test_login_nonexistent_user(self, auth_client: TestClient) -> None:
        """Non-existent username returns 401."""
        response = auth_client.post("/api/auth/login", json={"username": "nobody", "password": "somepassword"})
        assert response.status_code == 401

    def test_login_missing_fields(self, auth_client: TestClient) -> None:
        """Missing required login fields returns 422."""
        response = auth_client.post("/api/auth/login", json={"username": "loginuser"})
        assert response.status_code == 422


class TestAuthMe:
    """Test GET /api/auth/me."""

    def test_me_authenticated(self, authenticated_client: TestClient, test_user_credentials: dict) -> None:
        """Authenticated user receives their own profile."""
        response = authenticated_client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == test_user_credentials["username"]
        assert "password" not in data
        assert "password_hash" not in data

    def test_me_unauthenticated(self, auth_client: TestClient) -> None:
        """Unauthenticated request returns 4xx."""
        response = auth_client.get("/api/auth/me")
        assert response.status_code in (401, 403)

    def test_me_invalid_token(self, auth_client: TestClient) -> None:
        """Garbage bearer token returns 4xx."""
        response = auth_client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.valid.token"})
        assert response.status_code in (401, 403)


class TestAuthLogout:
    """Test POST /api/auth/logout."""

    def test_logout_authenticated(self, authenticated_client: TestClient) -> None:
        """Authenticated logout returns success message."""
        response = authenticated_client.post("/api/auth/logout")
        assert response.status_code == 200
        assert "logged out" in response.json()["message"].lower()

    def test_logout_unauthenticated(self, auth_client: TestClient) -> None:
        """Unauthenticated logout returns 4xx."""
        response = auth_client.post("/api/auth/logout")
        assert response.status_code in (401, 403)


class TestAuthRefresh:
    """Test POST /api/auth/refresh."""

    @pytest.fixture()
    def token_pair(self, auth_client: TestClient, test_database: "DuckLakeGeneDatabase") -> Generator[dict]:
        """Create a user and return a valid token pair."""
        from datetime import datetime

        from gorgonetics.auth.utils import get_password_hash
        from gorgonetics.constants import UserRole

        password_hash = get_password_hash("refreshpassword")
        now = datetime.now()
        result = test_database.conn.execute("SELECT MAX(id) FROM users").fetchone()
        next_id = (result[0] or 0) + 1
        test_database.conn.execute(
            "INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (next_id, "refreshuser", password_hash, UserRole.USER, True, now, now),
        )
        login_resp = auth_client.post("/api/auth/login", json={"username": "refreshuser", "password": "refreshpassword"})
        assert login_resp.status_code == 200
        yield login_resp.json()
        test_database.conn.execute("DELETE FROM users WHERE username = 'refreshuser'")

    def test_refresh_valid_token(self, auth_client: TestClient, token_pair: dict) -> None:
        """Valid refresh token returns a new token pair."""
        response = auth_client.post("/api/auth/refresh", json={"refresh_token": token_pair["refresh_token"]})
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    def test_refresh_invalid_token(self, auth_client: TestClient) -> None:
        """Garbage refresh token returns 401."""
        response = auth_client.post("/api/auth/refresh", json={"refresh_token": "not.a.valid.token"})
        assert response.status_code == 401

    def test_refresh_access_token_rejected(self, auth_client: TestClient, token_pair: dict) -> None:
        """Passing an access token to the refresh endpoint returns 401."""
        response = auth_client.post("/api/auth/refresh", json={"refresh_token": token_pair["access_token"]})
        assert response.status_code == 401

    def test_refresh_missing_token(self, auth_client: TestClient) -> None:
        """Missing refresh_token field returns 422."""
        response = auth_client.post("/api/auth/refresh", json={})
        assert response.status_code == 422
