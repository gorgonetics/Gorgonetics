"""
DuckLake-based database module for Gorgonetics gene data management.

This module provides multi-user support using DuckLake format with various
catalog database backends (PostgreSQL, MySQL, SQLite, DuckDB).
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from types import TracebackType
from typing import Any

import duckdb

from .attribute_config import AttributeConfig

logger = logging.getLogger(__name__)


class DuckLakeGeneDatabase:
    """Multi-user database manager for gene data using DuckLake format."""

    def __init__(
        self,
        catalog_type: str = "sqlite",
        catalog_path: str = "metadata.sqlite",
        data_path: str = "data",
        ducklake_name: str = "gorgonetics_lake",
    ):
        """
        Initialize the DuckLake gene database.

        Args:
            catalog_type: Type of catalog database ('sqlite', 'postgresql', 'mysql', 'duckdb')
            catalog_path: Path or connection string for catalog database
            data_path: Path to directory containing Parquet data files
            ducklake_name: Name for the DuckLake attachment
        """
        self.catalog_type = catalog_type
        self.catalog_path = catalog_path
        self.data_path = Path(data_path)
        self.ducklake_name = ducklake_name
        self.conn: duckdb.DuckDBPyConnection | None = None

        # Ensure data directory exists
        self.data_path.mkdir(parents=True, exist_ok=True)

        self._connect()
        self._setup_ducklake()

    def _connect(self) -> None:
        """Establish connection to DuckDB and install required extensions."""
        try:
            self.conn = duckdb.connect()

            # Install and load DuckLake extension
            self.conn.execute("INSTALL ducklake")
            self.conn.execute("LOAD ducklake")

            # Install catalog-specific extensions
            if self.catalog_type == "sqlite":
                self.conn.execute("INSTALL sqlite")
                self.conn.execute("LOAD sqlite")
            elif self.catalog_type == "postgresql":
                self.conn.execute("INSTALL postgres")
                self.conn.execute("LOAD postgres")
            elif self.catalog_type == "mysql":
                self.conn.execute("INSTALL mysql")
                self.conn.execute("LOAD mysql")

            logger.info(f"Connected to DuckDB with {self.catalog_type} catalog support")

        except Exception as e:
            logger.error(f"Failed to connect to DuckDB: {e}")
            raise

    def _setup_ducklake(self) -> None:
        """Attach to DuckLake catalog and set up initial schema."""
        try:
            # Build attach string based on catalog type
            if self.catalog_type == "sqlite":
                attach_string = f"ducklake:sqlite:{self.catalog_path}"
            elif self.catalog_type == "postgresql":
                attach_string = f"ducklake:postgres:{self.catalog_path}"
            elif self.catalog_type == "mysql":
                attach_string = f"ducklake:mysql:{self.catalog_path}"
            else:  # duckdb
                attach_string = f"ducklake:{self.catalog_path}"

            # Attach to DuckLake
            if self.catalog_type == "duckdb":
                attach_sql = f"ATTACH '{attach_string}' AS {self.ducklake_name}"
            else:
                attach_sql = f"ATTACH '{attach_string}' AS {self.ducklake_name} (DATA_PATH '{self.data_path}')"

            self.conn.execute(attach_sql)
            self.conn.execute(f"USE {self.ducklake_name}")

            logger.info(f"Attached to DuckLake: {self.ducklake_name}")

            # Create tables if they don't exist
            self._create_tables()

        except Exception as e:
            logger.error(f"Failed to setup DuckLake: {e}")
            raise

    def _create_tables(self) -> None:
        """Create the necessary database tables in DuckLake."""
        # Genes table (static reference data)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS genes (
                animal_type VARCHAR NOT NULL,
                chromosome VARCHAR NOT NULL,
                gene VARCHAR NOT NULL,
                effect_dominant VARCHAR DEFAULT 'None',
                effect_recessive VARCHAR DEFAULT 'None',
                appearance VARCHAR DEFAULT '|String for me to fill in|',
                notes VARCHAR DEFAULT '|String for me to fill in|',
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)

        # Create pets table with dynamic attribute columns
        self._create_pets_table()

        logger.info("Created DuckLake tables")

    def _serialize_datetime_fields(self, data: dict[str, Any]) -> dict[str, Any]:
        """Convert datetime objects to ISO format strings in a dictionary."""
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
        return data

    def _create_pets_table(self) -> None:
        """Create pets table with dynamic columns based on attribute configuration."""
        try:
            # Check if pets table already exists
            tables = self.conn.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_name = 'pets'
            """).fetchall()

            if tables:
                logger.debug("Pets table already exists")
                return

            # Get dynamic attributes from config for all species
            config = AttributeConfig()
            dynamic_columns = []

            # Get core attributes first
            core_attrs = config.get_core_attributes()
            for attr_name, attr_config in core_attrs.items():
                column_type = "VARCHAR" if attr_config.get("type") == "string" else "INTEGER"
                dynamic_columns.append(f"{attr_name} {column_type}")

            # Get species-specific attributes for known species
            for species in ["horse", "beewasp"]:
                species_attrs = config.get_species_attributes(species)
                for attr_name, attr_config in species_attrs.items():
                    # Avoid duplicates
                    if attr_name not in core_attrs:
                        column_type = "VARCHAR" if attr_config.get("type") == "string" else "INTEGER"
                        dynamic_columns.append(f"{attr_name} {column_type}")

            # Build CREATE TABLE statement
            base_columns = [
                "id INTEGER",
                "name VARCHAR NOT NULL",
                "species VARCHAR NOT NULL",
                "breeder VARCHAR",
                "content_hash VARCHAR NOT NULL",
                "genome_data JSON NOT NULL",
                "notes TEXT",
                "created_at TIMESTAMP",
                "updated_at TIMESTAMP",
            ]

            all_columns = base_columns + dynamic_columns
            create_sql = f"CREATE TABLE pets ({', '.join(all_columns)})"

            self.conn.execute(create_sql)
            logger.info("Created pets table with dynamic columns")

        except Exception as e:
            logger.error(f"Failed to create pets table: {e}")
            raise

    def load_from_json_files(self, json_directory: str) -> None:
        """Load gene data from JSON template files into DuckLake."""
        json_path = Path(json_directory)
        if not json_path.exists():
            logger.warning(f"JSON directory not found: {json_path}")
            return

        logger.info(f"Loading gene data from {json_path}")

        for json_file in json_path.glob("*.json"):
            animal_type = json_file.stem
            logger.info(f"Loading genes for {animal_type}")
            self._load_animal_genes(json_file, animal_type)

        # Commit changes to create a snapshot
        self.conn.commit()
        logger.info("Gene data loaded and snapshot created")

    def _load_animal_genes(self, json_file: Path, animal_type: str) -> None:
        """Load genes for a specific animal type from JSON file."""
        try:
            with open(json_file) as f:
                data = json.load(f)

            for chromosome, genes in data.items():
                for gene_name, gene_data in genes.items():
                    self._upsert_gene(animal_type, chromosome, gene_name, gene_data)

        except Exception as e:
            logger.error(f"Failed to load genes from {json_file}: {e}")
            raise

    def _upsert_gene(self, animal_type: str, chromosome: str, gene: str, gene_data: dict[str, Any]) -> None:
        """Insert or update a gene record."""
        effect_dominant = gene_data.get("effect_dominant", "None")
        effect_recessive = gene_data.get("effect_recessive", "None")
        appearance = gene_data.get("appearance", "|String for me to fill in|")
        notes = gene_data.get("notes", "|String for me to fill in|")

        # Use regular INSERT (DuckLake doesn't support INSERT OR REPLACE without primary keys)
        try:
            self.conn.execute(
                """
                INSERT INTO genes (
                    animal_type, chromosome, gene, effect_dominant,
                    effect_recessive, appearance, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            """,
                [animal_type, chromosome, gene, effect_dominant, effect_recessive, appearance, notes],
            )
        except Exception:
            # Skip duplicates
            pass

    def get_animal_types(self) -> list[str]:
        """Get list of all animal types."""
        result = self.conn.execute("SELECT DISTINCT animal_type FROM genes ORDER BY animal_type").fetchall()
        return [row[0] for row in result]

    def get_chromosomes(self, animal_type: str) -> list[str]:
        """Get list of chromosomes for a specific animal type."""
        result = self.conn.execute(
            """
            SELECT DISTINCT chromosome FROM genes
            WHERE animal_type = ?
            ORDER BY chromosome
        """,
            [animal_type],
        ).fetchall()
        return [row[0] for row in result]

    def get_genes_by_chromosome(self, animal_type: str, chromosome: str) -> list[dict[str, Any]]:
        """Get all genes for a specific animal type and chromosome."""
        result = self.conn.execute(
            """
            SELECT animal_type, chromosome, gene, effect_dominant, effect_recessive,
                   appearance, notes, created_at, updated_at
            FROM genes
            WHERE animal_type = ? AND chromosome = ?
            ORDER BY gene
        """,
            [animal_type, chromosome],
        ).fetchall()

        return [
            {
                "animal_type": row[0],
                "chromosome": row[1],
                "gene": row[2],
                "effectDominant": row[3] or "None",
                "effectRecessive": row[4] or "None",
                "appearance": row[5],
                "notes": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
                "updated_at": row[8].isoformat() if row[8] else None,
            }
            for row in result
        ]

    def get_genes_for_animal(self, animal_type: str) -> list[dict[str, Any]]:
        """Get all genes for a specific animal type."""
        result = self.conn.execute(
            """
            SELECT animal_type, chromosome, gene, effect_dominant, effect_recessive,
                   appearance, notes, created_at, updated_at
            FROM genes
            WHERE animal_type = ?
            ORDER BY chromosome, gene
        """,
            [animal_type],
        ).fetchall()

        return [
            {
                "animal_type": row[0],
                "chromosome": row[1],
                "gene": row[2],
                "effectDominant": row[3] or "None",
                "effectRecessive": row[4] or "None",
                "appearance": row[5],
                "notes": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
                "updated_at": row[8].isoformat() if row[8] else None,
            }
            for row in result
        ]

    def update_gene(self, animal_type: str, gene: str, updates: dict[str, str]) -> bool:
        """Update a gene record."""
        try:
            # Build dynamic UPDATE query
            set_clauses = []
            values = []

            for field, value in updates.items():
                if field in ["effect_dominant", "effect_recessive", "appearance", "notes"]:
                    set_clauses.append(f"{field} = ?")
                    values.append(value)

            if not set_clauses:
                return False

            set_clauses.append("updated_at = NOW()")
            values.extend([animal_type, gene])

            query = f"""
                UPDATE genes
                SET {", ".join(set_clauses)}
                WHERE animal_type = ? AND gene = ?
            """

            self.conn.execute(query, values)

            # Commit to create snapshot
            self.conn.commit()
            return True

        except Exception as e:
            logger.error(f"Failed to update gene {animal_type}:{gene}: {e}")
            return False

    def get_gene(self, animal_type: str, gene: str) -> dict[str, Any] | None:
        """Get a specific gene record."""
        result = self.conn.execute(
            """
            SELECT animal_type, chromosome, gene, effect_dominant, effect_recessive,
                   appearance, notes, created_at, updated_at
            FROM genes
            WHERE animal_type = ? AND gene = ?
        """,
            [animal_type, gene],
        ).fetchall()

        if result:
            row = result[0]
            return {
                "animal_type": row[0],
                "chromosome": row[1],
                "gene": row[2],
                "effectDominant": row[3] or "None",
                "effectRecessive": row[4] or "None",
                "appearance": row[5],
                "notes": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
                "updated_at": row[8].isoformat() if row[8] else None,
            }
        return None

    def add_pet(
        self,
        name: str,
        species: str,
        breeder: str | None,
        genome_data: str,
        content_hash: str,
        attributes: dict[str, float] | None = None,
        notes: str | None = None,
    ) -> int | None:
        """
        Add a new pet to the database.

        Args:
            name: Pet's name
            species: Pet's species (e.g., BeeWasp, Horse)
            breeder: Breeder name
            genome_data: Serialized genome JSON
            content_hash: SHA-256 hash of original file content
            attributes: Dynamic attributes dictionary
            notes: Optional notes
        """
        try:
            # Get dynamic attributes
            all_attributes = AttributeConfig.get_all_attributes(species)

            # Prepare base columns and values
            columns = ["name", "species", "content_hash", "genome_data"]
            values = [name, species, content_hash, genome_data]

            # Add breeder if provided
            if breeder:
                columns.append("breeder")
                values.append(breeder)

            # Add notes if provided
            if notes:
                columns.append("notes")
                values.append(notes)

            # Add dynamic attribute columns
            if attributes:
                for attr_name in all_attributes.keys():
                    if attr_name in attributes:
                        columns.append(attr_name)
                        values.append(attributes[attr_name])

            # Add timestamp columns
            columns.extend(["created_at", "updated_at"])
            values.extend([None, None])  # Will be set by NOW() in query

            placeholders = []
            for _i, col in enumerate(columns):
                if col in ["created_at", "updated_at"]:
                    placeholders.append("NOW()")
                else:
                    placeholders.append("?")

            # Remove None values for timestamp columns
            values = [v for i, v in enumerate(values) if columns[i] not in ["created_at", "updated_at"]]

            # Get next ID first (DuckLake doesn't support RETURNING)
            max_id_result = self.conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM pets").fetchone()
            next_id = max_id_result[0] if max_id_result else 1

            # Add id to columns and values
            columns.insert(0, "id")
            values.insert(0, next_id)
            placeholders.insert(0, "?")

            query = f"""
                INSERT INTO pets ({", ".join(columns)})
                VALUES ({", ".join(placeholders)})
            """

            self.conn.execute(query, values)

            # Commit to create snapshot
            self.conn.commit()

            return int(next_id)

        except Exception as e:
            logger.error(f"Failed to add pet: {e}")
            import traceback

            traceback.print_exc()
            return None

    def get_pet(self, pet_id: int) -> dict[str, Any] | None:
        """Get a pet by ID."""
        try:
            result = self.conn.execute("SELECT * FROM pets WHERE id = ?", [pet_id]).fetchone()

            if result:
                # Get column names
                columns = [desc[0] for desc in self.conn.description]

                # Build pet dictionary
                pet = dict(zip(columns, result, strict=False))

                # Note: genome_data is already parsed by DuckDB's JSON column type

                # Serialize datetime fields
                pet = self._serialize_datetime_fields(pet)

                return pet
            return None

        except Exception as e:
            logger.error(f"Failed to get pet {pet_id}: {e}")
            return None

    def get_all_pets(self, species: str | None = None) -> list[dict[str, Any]]:
        """Get all pets, optionally filtered by species."""
        try:
            if species:
                query = "SELECT * FROM pets WHERE species = ? ORDER BY name"
                params = [species]
            else:
                query = "SELECT * FROM pets ORDER BY name"
                params = []

            results = self.conn.execute(query, params).fetchall()

            if results:
                columns = [desc[0] for desc in self.conn.description]

                pets = []
                for result in results:
                    pet = dict(zip(columns, result, strict=False))

                    # Note: genome_data is already parsed by DuckDB's JSON column type

                    # Serialize datetime fields
                    pet = self._serialize_datetime_fields(pet)

                    pets.append(pet)

                return pets
            return []

        except Exception as e:
            logger.error(f"Failed to get pets: {e}")
            return []

    def update_pet(self, pet_id: int, updates: dict[str, Any]) -> bool:
        """Update a pet record."""
        try:
            # Build dynamic UPDATE query
            set_clauses = []
            values = []

            for field, value in updates.items():
                if field == "genome_data":
                    set_clauses.append(f"{field} = ?")
                    values.append(json.dumps(value))
                elif field != "id":  # Don't allow updating ID
                    set_clauses.append(f"{field} = ?")
                    values.append(value)

            if not set_clauses:
                return False

            set_clauses.append("updated_at = NOW()")
            values.append(pet_id)

            query = f"""
                UPDATE pets
                SET {", ".join(set_clauses)}
                WHERE id = ?
            """

            self.conn.execute(query, values)

            # Commit to create snapshot
            self.conn.commit()
            return True

        except Exception as e:
            logger.error(f"Failed to update pet {pet_id}: {e}")
            return False

    def delete_pet(self, pet_id: int) -> bool:
        """Delete a pet from the database."""
        try:
            # Check if pet exists before deletion
            existing_pet = self.conn.execute("SELECT id FROM pets WHERE id = ?", [pet_id]).fetchone()
            if not existing_pet:
                return False

            # Delete the pet
            self.conn.execute("DELETE FROM pets WHERE id = ?", [pet_id])

            # Commit to create snapshot
            self.conn.commit()
            return True

        except Exception as e:
            logger.error(f"Failed to delete pet {pet_id}: {e}")
            return False

    def find_pet_by_hash(self, content_hash: str) -> dict[str, Any] | None:
        """Find a pet by its content hash."""
        try:
            result = self.conn.execute("SELECT * FROM pets WHERE content_hash = ?", [content_hash]).fetchone()

            if result:
                columns = [desc[0] for desc in self.conn.description]
                pet = dict(zip(columns, result, strict=False))

                # Note: genome_data is already parsed by DuckDB's JSON column type

                # Serialize datetime fields
                pet = self._serialize_datetime_fields(pet)

                return pet
            return None

        except Exception as e:
            logger.error(f"Failed to find pet by hash {content_hash}: {e}")
            return None

    def get_snapshots(self) -> list[dict[str, Any]]:
        """Get all DuckLake snapshots."""
        try:
            result = self.conn.execute(f"FROM ducklake_snapshots('{self.ducklake_name}')").fetchall()

            snapshots = []
            for row in result:
                snapshots.append(
                    {"snapshot_id": row[0], "snapshot_time": row[1], "schema_version": row[2], "changes": row[3]}
                )

            return snapshots

        except Exception as e:
            logger.error(f"Failed to get snapshots: {e}")
            return []

    def get_table_changes(self, table_name: str, start_snapshot: int, end_snapshot: int) -> list[dict[str, Any]]:
        """Get changes for a table between snapshots."""
        try:
            result = self.conn.execute(f"""
                FROM ducklake_table_changes('{self.ducklake_name}', 'main', '{table_name}', {start_snapshot}, {end_snapshot})
            """).fetchall()

            if result:
                columns = [desc[0] for desc in self.conn.description]
                return [dict(zip(columns, row, strict=False)) for row in result]
            return []

        except Exception as e:
            logger.error(f"Failed to get table changes: {e}")
            return []

    def cleanup_old_files(self, dry_run: bool = True) -> bool:
        """Clean up old DuckLake files."""
        try:
            query = f"FROM ducklake_cleanup_old_files('{self.ducklake_name}', dry_run={dry_run})"
            self.conn.execute(query)
            return True

        except Exception as e:
            logger.error(f"Failed to cleanup old files: {e}")
            return False

    def close(self) -> None:
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def __enter__(self) -> "DuckLakeGeneDatabase":
        """Context manager entry."""
        return self

    def __exit__(
        self,
        exc_type: type | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Context manager exit."""
        self.close()
