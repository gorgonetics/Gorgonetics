"""
Database configuration module for Gorgonetics.

This module provides configuration management for DuckLake with SQLite catalog.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .ducklake_database import DuckLakeGeneDatabase

# Load environment variables from .env file
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


@dataclass
class DatabaseConfig:
    """Database configuration settings for DuckLake with SQLite catalog."""

    # DuckLake settings
    catalog_path: str = "metadata.sqlite"
    data_path: str = "data"
    ducklake_name: str = "gorgonetics_lake"

    # Multi-user settings
    enable_concurrent_access: bool = False
    session_timeout_minutes: int = 30

    @classmethod
    def from_environment(cls) -> "DatabaseConfig":
        """Create configuration from environment variables."""
        config = cls()

        # DuckLake settings
        config.catalog_path = os.getenv("GORGONETICS_CATALOG_PATH", "metadata.sqlite")
        config.data_path = os.getenv("GORGONETICS_DATA_PATH", "data")
        config.ducklake_name = os.getenv("GORGONETICS_DUCKLAKE_NAME", "gorgonetics_lake")

        # Multi-user settings
        config.enable_concurrent_access = os.getenv("GORGONETICS_CONCURRENT_ACCESS", "false").lower() == "true"
        config.session_timeout_minutes = int(os.getenv("GORGONETICS_SESSION_TIMEOUT", "30"))

        return config

    @property
    def is_multi_user_capable(self) -> bool:
        """Check if current configuration supports multi-user access."""
        # DuckLake with SQLite catalog supports multi-user access
        return True

    def get_connection_string(self) -> str:
        """Get connection string for DuckLake with SQLite catalog."""
        return f"ducklake:sqlite:{self.catalog_path}"

    def validate(self) -> list[str]:
        """Validate configuration and return list of errors."""
        errors = []

        # Validate data path exists or can be created
        data_path = Path(self.data_path)
        try:
            data_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            errors.append(f"Cannot create data directory {data_path}: {e}")

        # Validate SQLite catalog path
        catalog_path = Path(self.catalog_path)
        try:
            catalog_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            errors.append(f"Cannot create catalog directory {catalog_path.parent}: {e}")

        # Validate session timeout
        if self.session_timeout_minutes <= 0:
            errors.append("Session timeout must be positive")

        return errors

    def get_environment_template(self) -> str:
        """Get template for environment variables."""
        return """
# Gorgonetics Database Configuration
# Uses DuckLake with SQLite catalog

# DuckLake settings
GORGONETICS_CATALOG_PATH=metadata.sqlite
GORGONETICS_DATA_PATH=data
GORGONETICS_DUCKLAKE_NAME=gorgonetics_lake

# Multi-user settings
GORGONETICS_CONCURRENT_ACCESS=true
GORGONETICS_SESSION_TIMEOUT=30
        """.strip()


def get_database_config() -> DatabaseConfig:
    """Get database configuration from environment or defaults."""
    return DatabaseConfig.from_environment()


def create_database_instance() -> "DuckLakeGeneDatabase":
    """Create DuckLake database instance."""
    config = get_database_config()

    # Validate configuration
    errors = config.validate()
    if errors:
        raise ValueError(f"Database configuration errors: {'; '.join(errors)}")

    # Create DuckLake database instance
    from .ducklake_database import DuckLakeGeneDatabase

    return DuckLakeGeneDatabase(
        catalog_type="sqlite",
        catalog_path=config.catalog_path,
        data_path=config.data_path,
        ducklake_name=config.ducklake_name,
    )
