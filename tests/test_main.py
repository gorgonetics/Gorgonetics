"""Test the main module."""

import gorgonetics


def test_version() -> None:
    """Test that version is defined."""
    assert hasattr(gorgonetics, "__version__")
    assert gorgonetics.__version__ == "0.1.0"


def test_main_function() -> None:
    """Test that main function is available."""
    assert hasattr(gorgonetics, "main")
    assert callable(gorgonetics.main)
