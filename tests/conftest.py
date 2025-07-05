"""Test configuration and fixtures for PGBreeder."""

import pytest
from typer.testing import CliRunner

from pgbreeder.cli import app


@pytest.fixture
def runner():
    """Create a CLI runner for testing."""
    return CliRunner()


@pytest.fixture
def cli_app():
    """Return the CLI application for testing."""
    return app
