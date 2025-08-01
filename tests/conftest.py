"""Test configuration and fixtures for Gorgonetics."""

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
