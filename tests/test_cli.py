"""Test the CLI interface."""

from typer.testing import CliRunner

from gorgonetics.cli import app


def test_version_option() -> None:
    """Test that --version flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert "Gorgonetics version" in result.stdout


def test_main_no_args() -> None:
    """Test running the CLI with no arguments."""
    runner = CliRunner()
    result = runner.invoke(app, [])
    # CLI shows help when no command is provided
    assert result.exit_code == 2


def test_invalid_command() -> None:
    """Test running the CLI with an invalid command."""
    runner = CliRunner()
    result = runner.invoke(app, ["nonexistent"])
    # Should exit with error code for invalid command
    assert result.exit_code != 0


def test_help_option() -> None:
    """Test that --help flag works."""
    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "Gorgon genetics breeding tool for Project Gorgon" in result.stdout
