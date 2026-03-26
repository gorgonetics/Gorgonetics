"""
Integration tests for authentication endpoints.

Covers registration, login, /me, logout, token refresh, and admin user management.
"""

from collections.abc import Generator
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from gorgonetics.web_app import app

if TYPE_CHECKING:
    from gorgonetics.auth.database import AuthDatabase
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase


@pytest.fixture(scope="function")
def auth_client(test_database: "DuckLakeGeneDatabase") -> Generator[TestClient]:
    """Plain TestClient using test database — no auth headers pre-applied."""
    test_client = TestClient(app)
    yield test_client


class TestAuthRegister:
    """Test POST /api/auth/register (admin-only, invite-only)."""

    def test_register_requires_auth(self, auth_client: TestClient) -> None:
        """Unauthenticated registration returns 401/403."""
        response = auth_client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "password123"},
        )
        assert response.status_code in (401, 403)

    def test_register_requires_admin(self, authenticated_client: TestClient) -> None:
        """Regular user cannot register new users (403)."""
        response = authenticated_client.post(
            "/api/auth/register",
            json={"username": "newuser", "password": "password123"},
        )
        assert response.status_code == 403

    def test_register_admin_creates_user(self, admin_client: TestClient, test_auth_db: "AuthDatabase") -> None:
        """Admin can register new users."""
        response = admin_client.post(
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

    def test_register_duplicate_username(self, admin_client: TestClient) -> None:
        """Registering a username that already exists returns 400."""
        admin_client.post("/api/auth/register", json={"username": "dupuser", "password": "password123"})
        response = admin_client.post("/api/auth/register", json={"username": "dupuser", "password": "password456"})
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"]

    def test_register_short_password(self, admin_client: TestClient) -> None:
        """Passwords shorter than 8 characters are rejected (Pydantic validation)."""
        response = admin_client.post("/api/auth/register", json={"username": "shortpwuser", "password": "abc"})
        assert response.status_code == 422

    def test_register_short_username(self, admin_client: TestClient) -> None:
        """Usernames shorter than 3 characters are rejected (Pydantic validation)."""
        response = admin_client.post("/api/auth/register", json={"username": "ab", "password": "validpassword"})
        assert response.status_code == 422

    def test_register_missing_fields(self, admin_client: TestClient) -> None:
        """Omitting required fields returns 422."""
        response = admin_client.post("/api/auth/register", json={"username": "nopassword"})
        assert response.status_code == 422


class TestAuthLogin:
    """Test POST /api/auth/login."""

    @pytest.fixture(autouse=True)
    def _create_login_user(self, test_auth_db: "AuthDatabase") -> Generator[None]:
        """Insert a test user for login tests."""
        from gorgonetics.auth.utils import get_password_hash

        password_hash = get_password_hash("loginpassword")
        test_auth_db.create_user("loginuser", password_hash, role="user")
        yield

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
    def token_pair(self, auth_client: TestClient, test_auth_db: "AuthDatabase") -> Generator[dict]:
        """Create a user and return a valid token pair."""
        from gorgonetics.auth.utils import get_password_hash

        password_hash = get_password_hash("refreshpassword")
        test_auth_db.create_user("refreshuser", password_hash, role="user")
        login_resp = auth_client.post(
            "/api/auth/login", json={"username": "refreshuser", "password": "refreshpassword"}
        )
        assert login_resp.status_code == 200
        yield login_resp.json()

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


class TestAdminUserManagement:
    """Test admin user management endpoints (/api/admin/users)."""

    def test_list_users(self, admin_client: TestClient) -> None:
        """Admin can list all users."""
        response = admin_client.get("/api/admin/users")
        assert response.status_code == 200
        users = response.json()
        assert isinstance(users, list)
        assert len(users) >= 1
        assert any(u["username"] == "testadmin" for u in users)

    def test_list_users_requires_admin(self, authenticated_client: TestClient) -> None:
        """Regular user cannot list users."""
        response = authenticated_client.get("/api/admin/users")
        assert response.status_code == 403

    def test_list_users_unauthenticated(self, auth_client: TestClient) -> None:
        """Unauthenticated user cannot list users."""
        response = auth_client.get("/api/admin/users")
        assert response.status_code in (401, 403)

    def test_get_user(self, admin_client: TestClient) -> None:
        """Admin can get a single user by ID."""
        users = admin_client.get("/api/admin/users").json()
        user_id = users[0]["id"]
        response = admin_client.get(f"/api/admin/users/{user_id}")
        assert response.status_code == 200
        assert response.json()["id"] == user_id

    def test_get_user_not_found(self, admin_client: TestClient) -> None:
        """Getting a non-existent user returns 404."""
        response = admin_client.get("/api/admin/users/99999")
        assert response.status_code == 404

    def test_update_user_role(self, admin_client: TestClient) -> None:
        """Admin can change a user's role."""
        admin_client.post("/api/auth/register", json={"username": "roletest", "password": "password123"})
        users = admin_client.get("/api/admin/users").json()
        target = next(u for u in users if u["username"] == "roletest")

        response = admin_client.patch(f"/api/admin/users/{target['id']}", json={"role": "admin"})
        assert response.status_code == 200
        assert response.json()["role"] == "admin"

    def test_update_user_deactivate(self, admin_client: TestClient) -> None:
        """Admin can deactivate a user."""
        admin_client.post("/api/auth/register", json={"username": "deactivatetest", "password": "password123"})
        users = admin_client.get("/api/admin/users").json()
        target = next(u for u in users if u["username"] == "deactivatetest")

        response = admin_client.patch(f"/api/admin/users/{target['id']}", json={"is_active": False})
        assert response.status_code == 200
        assert response.json()["is_active"] is False

    def test_cannot_modify_self(self, admin_client: TestClient) -> None:
        """Admin cannot modify their own account via admin endpoints."""
        admin_user_id = admin_client.admin_user_id
        response = admin_client.patch(f"/api/admin/users/{admin_user_id}", json={"role": "user"})
        assert response.status_code == 400
        assert "own account" in response.json()["detail"].lower()

    def test_cannot_delete_self(self, admin_client: TestClient) -> None:
        """Admin cannot delete their own account."""
        admin_user_id = admin_client.admin_user_id
        response = admin_client.delete(f"/api/admin/users/{admin_user_id}")
        assert response.status_code == 400
        assert "own account" in response.json()["detail"].lower()

    def test_delete_user(self, admin_client: TestClient) -> None:
        """Admin can delete a user."""
        admin_client.post("/api/auth/register", json={"username": "deletetest", "password": "password123"})
        users = admin_client.get("/api/admin/users").json()
        target = next(u for u in users if u["username"] == "deletetest")

        response = admin_client.delete(f"/api/admin/users/{target['id']}")
        assert response.status_code == 200
        assert "deleted" in response.json()["message"].lower()

        # Verify user is gone
        response = admin_client.get(f"/api/admin/users/{target['id']}")
        assert response.status_code == 404

    def test_delete_user_not_found(self, admin_client: TestClient) -> None:
        """Deleting a non-existent user returns 404."""
        response = admin_client.delete("/api/admin/users/99999")
        assert response.status_code == 404
