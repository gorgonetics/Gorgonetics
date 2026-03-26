"""
Integration tests for authorization (RBAC and user isolation).

Covers:
- Admin-only gene write endpoints reject regular users
- Admins can access and modify all pets
- User A cannot see, delete, or update User B's pets
- Pet update and delete endpoint ownership checks
"""

import tempfile
from collections.abc import Generator
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from gorgonetics.auth.utils import get_password_hash
from gorgonetics.constants import UserRole
from gorgonetics.database_config import create_auth_database_instance
from gorgonetics.web_app import app, get_database

if TYPE_CHECKING:
    from gorgonetics.auth.database import AuthDatabase
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase

# ---------------------------------------------------------------------------
# Shared pet genome content used by multiple tests
# ---------------------------------------------------------------------------

_PET_GENOME_TEMPLATE = """[Overview]
Format=v1.0
Character=TestBreeder
Entity={name}
Genome=Horse

[Genes]
01=RDRD RDRD RDRD RDRD RRDD RRDD RDRD RDRD

End of Genome
"""


def _make_genome_file(name: str) -> str:
    """Write a genome file to a temp path and return the path."""
    content = _PET_GENOME_TEMPLATE.format(name=name)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(content)
        return f.name


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _insert_user(username: str, password: str, role: str = UserRole.USER) -> int:
    """Insert a user into the auth DB and return its id."""
    password_hash = get_password_hash(password)
    auth_db = create_auth_database_instance()
    try:
        user = auth_db.create_user(username, password_hash, role=role)
        return user.id
    finally:
        auth_db.close()


def _make_client_for_user(username: str, password: str, role: str = UserRole.USER) -> TestClient:
    """Create and return an authenticated TestClient for the given user."""
    _insert_user(username, password, role)

    client = TestClient(app)
    login_resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login_resp.status_code == 200, f"Login failed for {username}: {login_resp.json()}"
    token = login_resp.json()["access_token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    original_request = client.request

    def _authed(*args: Any, **kwargs: Any) -> Any:
        if "headers" not in kwargs or kwargs["headers"] is None:
            kwargs["headers"] = {}
        kwargs["headers"].update(auth_headers)
        return original_request(*args, **kwargs)

    client.request = _authed  # type: ignore[method-assign]
    return client


@pytest.fixture(scope="function")
def db_and_client(
    test_database: "DuckLakeGeneDatabase",
    test_auth_db: "AuthDatabase",
) -> Generator[tuple["DuckLakeGeneDatabase", TestClient, TestClient]]:
    """
    Yields (db, admin_client, user_client).
    Also sets app.dependency_overrides so pet endpoints use the test DB.
    """
    app.dependency_overrides[get_database] = lambda: test_database

    admin_client = _make_client_for_user("auth_admin", "adminpass123", UserRole.ADMIN)
    user_client = _make_client_for_user("auth_user", "userpass123", UserRole.USER)

    yield test_database, admin_client, user_client

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def two_user_clients(
    test_database: "DuckLakeGeneDatabase",
    test_auth_db: "AuthDatabase",
) -> Generator[tuple["DuckLakeGeneDatabase", TestClient, TestClient]]:
    """
    Yields (db, user_a_client, user_b_client) for isolation tests.
    """
    app.dependency_overrides[get_database] = lambda: test_database

    user_a = _make_client_for_user("user_a", "usera_pass123")
    user_b = _make_client_for_user("user_b", "userb_pass123")

    yield test_database, user_a, user_b

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Gene write endpoints — admin only
# ---------------------------------------------------------------------------


class TestGeneWriteRBAC:
    """PUT /api/gene and PUT /api/genes require admin role."""

    def _seed_gene(self, db: "DuckLakeGeneDatabase") -> None:
        db._upsert_gene(
            "horse",
            "01",
            "01A1",
            {"effectDominant": "None", "effectRecessive": "Intelligence+", "appearance": "Mane Color", "notes": ""},
        )
        if db.conn:
            db.conn.commit()

    def test_admin_can_update_gene(self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]) -> None:
        db, admin_client, _ = db_and_client
        self._seed_gene(db)
        response = admin_client.put(
            "/api/gene",
            json={"animal_type": "horse", "gene": "01A1", "notes": "updated by admin"},
        )
        assert response.status_code == 200

    def test_regular_user_cannot_update_gene(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        db, _, user_client = db_and_client
        self._seed_gene(db)
        response = user_client.put(
            "/api/gene",
            json={"animal_type": "horse", "gene": "01A1", "notes": "attempted by user"},
        )
        assert response.status_code == 403

    def test_unauthenticated_cannot_update_gene(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        db, _, _ = db_and_client
        self._seed_gene(db)
        client = TestClient(app)
        response = client.put(
            "/api/gene",
            json={"animal_type": "horse", "gene": "01A1", "notes": "no auth"},
        )
        assert response.status_code in (401, 403)

    def test_admin_can_bulk_update_genes(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        db, admin_client, _ = db_and_client
        self._seed_gene(db)
        response = admin_client.put(
            "/api/genes",
            json={
                "animal_type": "horse",
                "chromosome": "01",
                "genes": [{"gene": "01A1", "notes": "bulk updated"}],
            },
        )
        assert response.status_code == 200

    def test_regular_user_cannot_bulk_update_genes(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        db, _, user_client = db_and_client
        self._seed_gene(db)
        response = user_client.put(
            "/api/genes",
            json={
                "animal_type": "horse",
                "chromosome": "01",
                "genes": [{"gene": "01A1", "notes": "attempted"}],
            },
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Pet update / delete ownership
# ---------------------------------------------------------------------------


class TestPetOwnership:
    """Only the owner (or admin) can update or delete a pet."""

    def _upload_pet(self, client: TestClient, unique_name: str) -> int:
        """Upload a pet and return its id."""
        genome_path = _make_genome_file(unique_name)
        with open(genome_path, "rb") as f:
            response = client.post(
                "/api/pets/upload",
                files={"file": ("genome.txt", f, "text/plain")},
                data={"name": unique_name, "gender": "male"},
            )
        assert response.status_code == 200, f"Upload failed: {response.json()}"
        return response.json()["pet_id"]

    def test_owner_can_update_own_pet(
        self, two_user_clients: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, user_a, _ = two_user_clients
        pet_id = self._upload_pet(user_a, "UserAPet_update_own")
        response = user_a.put(f"/api/pets/{pet_id}", json={"name": "Renamed Pet"})
        assert response.status_code == 200

    def test_owner_can_delete_own_pet(
        self, two_user_clients: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, user_a, _ = two_user_clients
        pet_id = self._upload_pet(user_a, "UserAPet_delete_own")
        response = user_a.delete(f"/api/pets/{pet_id}")
        assert response.status_code == 200

    def test_other_user_cannot_update_pet(
        self, two_user_clients: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, user_a, user_b = two_user_clients
        pet_id = self._upload_pet(user_a, "UserAPet_other_update")
        response = user_b.put(f"/api/pets/{pet_id}", json={"name": "Stolen Rename"})
        # Non-owners get 404 (pet appears not found to them)
        assert response.status_code == 404

    def test_other_user_cannot_delete_pet(
        self, two_user_clients: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, user_a, user_b = two_user_clients
        pet_id = self._upload_pet(user_a, "UserAPet_other_delete")
        response = user_b.delete(f"/api/pets/{pet_id}")
        assert response.status_code == 404

    def test_admin_can_update_any_pet(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, admin_client, user_client = db_and_client
        pet_id = self._upload_pet(user_client, "UserPet_admin_updates")
        response = admin_client.put(f"/api/pets/{pet_id}", json={"name": "Admin Renamed"})
        assert response.status_code == 200

    def test_admin_can_delete_any_pet(
        self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, admin_client, user_client = db_and_client
        pet_id = self._upload_pet(user_client, "UserPet_admin_deletes")
        response = admin_client.delete(f"/api/pets/{pet_id}")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Pet list isolation
# ---------------------------------------------------------------------------


class TestPetListIsolation:
    """Each user only sees their own pets; admins see all."""

    def _upload_pet(self, client: TestClient, unique_name: str) -> int:
        genome_path = _make_genome_file(unique_name)
        with open(genome_path, "rb") as f:
            response = client.post(
                "/api/pets/upload",
                files={"file": ("genome.txt", f, "text/plain")},
                data={"name": unique_name, "gender": "male"},
            )
        assert response.status_code == 200, f"Upload failed: {response.json()}"
        return response.json()["pet_id"]

    def test_users_only_see_own_pets(
        self, two_user_clients: tuple["DuckLakeGeneDatabase", TestClient, TestClient]
    ) -> None:
        _, user_a, user_b = two_user_clients
        pet_a_id = self._upload_pet(user_a, "IsolPetA_list")
        pet_b_id = self._upload_pet(user_b, "IsolPetB_list")

        pets_a = user_a.get("/api/pets").json()["items"]
        pets_b = user_b.get("/api/pets").json()["items"]

        pet_a_ids = [p["id"] for p in pets_a]
        pet_b_ids = [p["id"] for p in pets_b]

        assert pet_a_id in pet_a_ids
        assert pet_b_id not in pet_a_ids
        assert pet_b_id in pet_b_ids
        assert pet_a_id not in pet_b_ids

    def test_admin_sees_all_pets(self, db_and_client: tuple["DuckLakeGeneDatabase", TestClient, TestClient]) -> None:
        _, admin_client, user_client = db_and_client
        pet_id = self._upload_pet(user_client, "IsolPetUser_admin_sees")

        pets = admin_client.get("/api/pets").json()["items"]
        pet_ids = [p["id"] for p in pets]
        assert pet_id in pet_ids
