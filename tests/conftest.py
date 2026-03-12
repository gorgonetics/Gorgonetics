"""Test configuration and fixtures for Gorgonetics."""

import os
import tempfile

# Disable rate limiting before any app code is imported
os.environ.setdefault("TESTING", "1")
from collections.abc import Generator
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from gorgonetics.cli import app

if TYPE_CHECKING:
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase


@pytest.fixture
def runner() -> CliRunner:
    """Create a CLI runner for testing."""
    return CliRunner()


@pytest.fixture
def cli_app() -> object:
    """Return the CLI application for testing."""
    return app


@pytest.fixture(scope="function")
def test_database() -> Generator["DuckLakeGeneDatabase"]:
    """Create an isolated test database for each test."""
    with tempfile.TemporaryDirectory() as temp_dir:
        # Create temporary database files
        catalog_path = Path(temp_dir) / "test_metadata.sqlite"
        data_path = Path(temp_dir) / "test_data"
        data_path.mkdir()

        # Set environment variables to use test database
        original_catalog = os.environ.get("GORGONETICS_CATALOG_PATH")
        original_data = os.environ.get("GORGONETICS_DATA_PATH")

        os.environ["GORGONETICS_CATALOG_PATH"] = str(catalog_path)
        os.environ["GORGONETICS_DATA_PATH"] = str(data_path)

        try:
            # Create database instance with test configuration
            from gorgonetics.database_config import create_database_instance

            db = create_database_instance()

            yield db

            # Cleanup
            db.close()

        finally:
            # Restore original environment variables
            if original_catalog is not None:
                os.environ["GORGONETICS_CATALOG_PATH"] = original_catalog
            elif "GORGONETICS_CATALOG_PATH" in os.environ:
                del os.environ["GORGONETICS_CATALOG_PATH"]

            if original_data is not None:
                os.environ["GORGONETICS_DATA_PATH"] = original_data
            elif "GORGONETICS_DATA_PATH" in os.environ:
                del os.environ["GORGONETICS_DATA_PATH"]


@pytest.fixture
def sample_pet_file() -> Generator[str]:
    """Create a sample pet genome file for testing."""
    sample_content = """{
    "format": "gorgonetics",
    "formatVersion": "1.1",
    "name": "Test Pet",
    "owner": "Test Owner",
    "species": "Horse",
    "breeder": "Test Breeder",
    "genes": {
        "01": "01A1 01A2",
        "02": "02B1 02B2"
    }
}"""

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write(sample_content)
        f.flush()
        yield f.name

    # Cleanup
    try:
        os.unlink(f.name)
    except FileNotFoundError:
        pass


@pytest.fixture
def test_user_credentials():
    """Test user credentials for authentication tests."""
    return {"username": "testuser", "password": "testpassword123"}


@pytest.fixture
def authenticated_client(test_database: "DuckLakeGeneDatabase", test_user_credentials: dict) -> Generator[TestClient]:
    """Create an authenticated test client with a test user."""
    from datetime import datetime

    from gorgonetics.auth.utils import get_password_hash
    from gorgonetics.constants import UserRole
    from gorgonetics.web_app import app

    client = TestClient(app)

    # Create test user in database
    password_hash = get_password_hash(test_user_credentials["password"])
    now = datetime.now()

    # Get next user ID
    existing_users = test_database.conn.execute("SELECT id FROM users ORDER BY id DESC LIMIT 1").fetchone()
    next_id = (existing_users[0] + 1) if existing_users else 1

    # Insert test user
    test_database.conn.execute(
        """INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (next_id, test_user_credentials["username"], password_hash, UserRole.USER, True, now, now),
    )

    # Login to get auth token
    login_response = client.post("/api/auth/login", json=test_user_credentials)
    assert login_response.status_code == 200
    token_data = login_response.json()

    # Set authorization header for future requests
    auth_headers = {"Authorization": f"Bearer {token_data['access_token']}"}

    # Monkey patch the client to include auth headers by default
    original_request = client.request

    def authenticated_request(*args, **kwargs):
        if "headers" not in kwargs or kwargs["headers"] is None:
            kwargs["headers"] = {}
        kwargs["headers"].update(auth_headers)
        return original_request(*args, **kwargs)

    client.request = authenticated_request
    client.auth_headers = auth_headers

    yield client

    # Cleanup - remove test user
    test_database.conn.execute("DELETE FROM users WHERE username = ?", (test_user_credentials["username"],))
