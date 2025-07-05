"""Test the main module."""

import pgbreeder


def test_version():
    """Test that version is defined."""
    assert hasattr(pgbreeder, "__version__")
    assert pgbreeder.__version__ == "0.1.0"


def test_main_function():
    """Test that main function is available."""
    assert hasattr(pgbreeder, "main")
    assert callable(pgbreeder.main)
