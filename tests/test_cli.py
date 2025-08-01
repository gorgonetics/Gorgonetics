"""Test the CLI interface."""

from typer.testing import CliRunner

from pgbreeder.cli import app


def test_version_option():
    """Test that --version flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "PGBreeder version" in result.stdout


def test_main_no_args():
    """Test running the CLI with no arguments."""
    runner = CliRunner()
    result = runner.invoke(app, [])
    # CLI shows help when no command is provided
    assert result.exit_code == 2


def test_invalid_command():
    """Test running the CLI with an invalid command."""
    runner = CliRunner()
    result = runner.invoke(app, ["nonexistent"])
    # Should exit with error code for invalid command
    assert result.exit_code != 0


def test_help_option():
    """Test that --help flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "A simple CLI application" in result.stdout
