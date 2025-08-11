"""Test configuration and fixtures for Gorgonetics."""

import os
import tempfile
from pathlib import Path

import pytest
from typer.testing import CliRunner

from gorgonetics.cli import app


@pytest.fixture
def runner():
    """Create a CLI runner for testing."""
    return CliRunner()


@pytest.fixture
def cli_app():
    """Return the CLI application for testing."""
    return app


@pytest.fixture(scope="function")
def test_database():
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
def sample_pet_file():
    """Create a sample pet genome file for testing."""
    sample_content = '''{
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
}'''

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write(sample_content)
        f.flush()
        yield f.name

    # Cleanup
    try:
        os.unlink(f.name)
    except FileNotFoundError:
        pass
