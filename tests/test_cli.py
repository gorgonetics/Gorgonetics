"""Test the CLI interface."""

import pytest
from typer.testing import CliRunner

from pgbreeder.cli import app


def test_version_option():
    """Test that --version flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "PGBreeder version" in result.stdout


def test_hello_command():
    """Test the hello command."""
    runner = CliRunner()
    result = runner.invoke(app, ["hello"])
    assert result.exit_code == 0
    assert "Hello, World!" in result.stdout


def test_hello_command_with_name():
    """Test the hello command with a custom name."""
    runner = CliRunner()
    result = runner.invoke(app, ["hello", "Alice"])
    assert result.exit_code == 0
    assert "Hello, Alice!" in result.stdout


def test_help_option():
    """Test that --help flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "A simple CLI application" in result.stdout
