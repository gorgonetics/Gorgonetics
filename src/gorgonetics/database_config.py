"""
Database configuration module for Gorgonetics.

This module provides configuration management for switching between
different database backends (DuckDB, DuckLake with various catalogs).
"""

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class DatabaseBackend(Enum):
    """Supported database backends."""
    DUCKDB = "duckdb"
    DUCKLAKE = "ducklake"


class CatalogType(Enum):
    """Supported catalog types for DuckLake."""
    DUCKDB = "duckdb"
    SQLITE = "sqlite"
    POSTGRESQL = "postgresql"
    MYSQL = "mysql"


@dataclass
class DatabaseConfig:
    """Database configuration settings."""

    # Backend selection
    backend: DatabaseBackend = DatabaseBackend.DUCKDB

    # DuckDB settings
    duckdb_path: str = "gorgonetics.db"

    # DuckLake settings
    catalog_type: CatalogType = CatalogType.SQLITE
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

        # Backend selection
        backend_str = os.getenv("GORGONETICS_DB_BACKEND", "duckdb").lower()
        try:
            config.backend = DatabaseBackend(backend_str)
        except ValueError:
            config.backend = DatabaseBackend.DUCKDB

        # DuckDB settings
        config.duckdb_path = os.getenv("GORGONETICS_DUCKDB_PATH", "gorgonetics.db")

        # DuckLake settings
        catalog_type_str = os.getenv("GORGONETICS_CATALOG_TYPE", "sqlite").lower()
        try:
            config.catalog_type = CatalogType(catalog_type_str)
        except ValueError:
            config.catalog_type = CatalogType.SQLITE

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
        if self.backend == DatabaseBackend.DUCKDB:
            return False

        if self.backend == DatabaseBackend.DUCKLAKE:
            # DuckLake with DuckDB catalog is single-user
            if self.catalog_type == CatalogType.DUCKDB:
                return False
            # Other catalog types support multi-user
            return True

        return False

    def get_connection_string(self) -> str:
        """Get connection string for the configured backend."""
        if self.backend == DatabaseBackend.DUCKDB:
            return self.duckdb_path

        if self.backend == DatabaseBackend.DUCKLAKE:
            if self.catalog_type == CatalogType.SQLITE:
                return f"ducklake:sqlite:{self.catalog_path}"
            elif self.catalog_type == CatalogType.POSTGRESQL:
                return f"ducklake:postgres:{self.catalog_path}"
            elif self.catalog_type == CatalogType.MYSQL:
                return f"ducklake:mysql:{self.catalog_path}"
            else:  # DUCKDB
                return f"ducklake:{self.catalog_path}"

        raise ValueError(f"Unsupported backend: {self.backend}")

    def validate(self) -> list[str]:
        """Validate configuration and return list of errors."""
        errors = []

        if self.backend == DatabaseBackend.DUCKLAKE:
            # Validate data path exists or can be created
            data_path = Path(self.data_path)
            try:
                data_path.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                errors.append(f"Cannot create data directory {data_path}: {e}")

            # Validate catalog configuration
            if self.catalog_type == CatalogType.POSTGRESQL:
                if not self.catalog_path or "host=" not in self.catalog_path:
                    errors.append("PostgreSQL catalog requires connection string with host")

            elif self.catalog_type == CatalogType.MYSQL:
                if not self.catalog_path or "host=" not in self.catalog_path:
                    errors.append("MySQL catalog requires connection string with host")

            elif self.catalog_type == CatalogType.SQLITE:
                # Validate SQLite path
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

# Backend: 'duckdb' or 'ducklake'
GORGONETICS_DB_BACKEND=ducklake

# DuckDB settings (used when backend=duckdb)
GORGONETICS_DUCKDB_PATH=gorgonetics.db

# DuckLake settings (used when backend=ducklake)
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=metadata.sqlite
GORGONETICS_DATA_PATH=data
GORGONETICS_DUCKLAKE_NAME=gorgonetics_lake

# Multi-user settings
GORGONETICS_CONCURRENT_ACCESS=true
GORGONETICS_SESSION_TIMEOUT=30

# Example PostgreSQL catalog
# GORGONETICS_CATALOG_TYPE=postgresql
# GORGONETICS_CATALOG_PATH=dbname=gorgonetics_catalog host=localhost user=gorgonetics password=secret

# Example MySQL catalog
# GORGONETICS_CATALOG_TYPE=mysql
# GORGONETICS_CATALOG_PATH=db=gorgonetics_catalog host=localhost user=gorgonetics password=secret
        """.strip()


def get_database_config() -> DatabaseConfig:
    """Get database configuration from environment or defaults."""
    return DatabaseConfig.from_environment()


def create_database_instance():
    """Create appropriate database instance based on configuration."""
    config = get_database_config()

    # Validate configuration
    errors = config.validate()
    if errors:
        raise ValueError(f"Database configuration errors: {'; '.join(errors)}")

    if config.backend == DatabaseBackend.DUCKDB:
        from .database import GeneDatabase
        return GeneDatabase(db_path=config.duckdb_path)

    elif config.backend == DatabaseBackend.DUCKLAKE:
        from .ducklake_database import DuckLakeGeneDatabase
        return DuckLakeGeneDatabase(
            catalog_type=config.catalog_type.value,
            catalog_path=config.catalog_path,
            data_path=config.data_path,
            ducklake_name=config.ducklake_name
        )

    else:
        raise ValueError(f"Unsupported database backend: {config.backend}")
