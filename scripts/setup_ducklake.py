#!/usr/bin/env python3
"""
Setup script to initialize DuckLake with genetic data from JSON assets.

This script creates a fresh DuckLake database and loads genetic data
from the assets directory, enabling multi-user support.
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import duckdb


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the setup script."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )


def setup_ducklake_catalog(catalog_type: str, catalog_path: str, data_path: Path) -> duckdb.DuckDBPyConnection:
    """Set up DuckLake catalog database."""
    logging.info(f"Setting up DuckLake catalog: {catalog_type}")

    # Create new DuckDB connection for DuckLake setup
    conn = duckdb.connect()

    # Install required extensions
    conn.execute("INSTALL ducklake")
    conn.execute("LOAD ducklake")

    if catalog_type == "sqlite":
        conn.execute("INSTALL sqlite")
        conn.execute("LOAD sqlite")
        attach_string = f"ducklake:sqlite:{catalog_path}"
    elif catalog_type == "postgresql":
        conn.execute("INSTALL postgres")
        conn.execute("LOAD postgres")
        attach_string = f"ducklake:postgres:{catalog_path}"
    elif catalog_type == "mysql":
        conn.execute("INSTALL mysql")
        conn.execute("LOAD mysql")
        attach_string = f"ducklake:mysql:{catalog_path}"
    else:  # duckdb
        attach_string = f"ducklake:{catalog_path}"

    # Attach DuckLake catalog
    logging.info(f"Attaching DuckLake: {attach_string}")
    if catalog_type == "duckdb":
        conn.execute(f"ATTACH '{attach_string}' AS gorgonetics_lake")
    else:
        conn.execute(f"ATTACH '{attach_string}' AS gorgonetics_lake (DATA_PATH '{data_path}')")

    conn.execute("USE gorgonetics_lake")

    return conn


def create_tables(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the necessary database tables in DuckLake."""
    logging.info("Creating DuckLake tables...")

    # Genes table (static reference data)
    conn.execute("""
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

    # Pets table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pets (
            id INTEGER,
            name VARCHAR NOT NULL,
            species VARCHAR NOT NULL,
            content_hash VARCHAR NOT NULL,
            genome_data JSON NOT NULL,
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        )
    """)

    logging.info("Tables created successfully")


def load_genetic_data(conn: duckdb.DuckDBPyConnection, assets_dir: Path) -> None:
    """Load genetic data from JSON files in the assets directory."""
    if not assets_dir.exists():
        logging.warning(f"Assets directory not found: {assets_dir}")
        return

    logging.info(f"Loading genetic data from {assets_dir}")

    # Find all JSON files in subdirectories
    json_files = list(assets_dir.rglob("*.json"))

    if not json_files:
        logging.warning("No JSON files found in assets directory")
        return

    genes_loaded = 0

    for json_file in json_files:
        # Determine animal type from directory structure
        # e.g., assets/horse/horse.json -> horse
        animal_type = json_file.parent.name

        logging.info(f"Loading genes for {animal_type} from {json_file}")

        try:
            with open(json_file, 'r') as f:
                data = json.load(f)

            # Extract chromosome from filename (e.g., horse_genes_chr01.json -> chr01)
            chromosome = json_file.stem.split('_')[-1]  # Get last part after underscore

            # Load genes from the JSON array structure
            if isinstance(data, list):
                for gene_data in data:
                    if isinstance(gene_data, dict):
                        gene_name = gene_data.get("gene", "")
                        effect_dominant = gene_data.get("effectDominant", "None")
                        effect_recessive = gene_data.get("effectRecessive", "None")
                        appearance = gene_data.get("appearance", "|String for me to fill in|")
                        notes = gene_data.get("notes", "|String for me to fill in|")

                        if gene_name:  # Only insert if gene name exists
                            # Insert gene (skip duplicates)
                            try:
                                conn.execute("""
                                    INSERT INTO genes (
                                        animal_type, chromosome, gene, effect_dominant,
                                        effect_recessive, appearance, notes, created_at, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                                """, [animal_type, chromosome, gene_name, effect_dominant,
                                      effect_recessive, appearance, notes])
                            except Exception as e:
                                # Skip duplicate genes
                                logging.debug(f"Skipping duplicate gene {animal_type}:{gene_name} - {e}")
                                continue

                            genes_loaded += 1

        except Exception as e:
            logging.error(f"Failed to load genes from {json_file}: {e}")
            continue

    logging.info(f"Loaded {genes_loaded} genes from {len(json_files)} files")


def create_initial_snapshot(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the initial snapshot in DuckLake."""
    logging.info("Creating initial DuckLake snapshot...")

    # Force a commit to create the initial snapshot
    conn.commit()

    # Show snapshot information
    try:
        snapshots = conn.execute("FROM ducklake_snapshots('gorgonetics_lake')").fetchall()
        logging.info(f"Created {len(snapshots)} snapshot(s)")

        for snapshot in snapshots:
            logging.debug(f"Snapshot {snapshot[0]}: {snapshot[1]}")
    except Exception as e:
        logging.warning(f"Could not retrieve snapshot info: {e}")


def verify_setup(conn: duckdb.DuckDBPyConnection) -> bool:
    """Verify that setup was successful."""
    logging.info("Verifying DuckLake setup...")

    try:
        # Check genes count
        genes_count = conn.execute("SELECT COUNT(*) FROM genes").fetchone()[0]

        # Check pets count (should be 0 for fresh setup)
        pets_count = conn.execute("SELECT COUNT(*) FROM pets").fetchone()[0]

        # Check animal types
        animal_types = conn.execute("SELECT DISTINCT animal_type FROM genes ORDER BY animal_type").fetchall()
        animal_list = [row[0] for row in animal_types]

        logging.info(f"Setup verified: {genes_count} genes, {pets_count} pets")
        logging.info(f"Animal types: {', '.join(animal_list)}")

        if genes_count > 0:
            return True
        else:
            logging.error("No genes loaded - setup may have failed")
            return False

    except Exception as e:
        logging.error(f"Verification failed: {e}")
        return False


def main() -> int:
    """Main setup function."""
    parser = argparse.ArgumentParser(description="Set up DuckLake database with genetic data")
    parser.add_argument(
        "--assets-dir",
        type=Path,
        default=Path("assets"),
        help="Directory containing genetic data JSON files (default: assets)"
    )
    parser.add_argument(
        "--catalog-type",
        choices=["duckdb", "sqlite", "postgresql", "mysql"],
        default="sqlite",
        help="Type of catalog database (default: sqlite)"
    )
    parser.add_argument(
        "--catalog-path",
        type=str,
        default="metadata.sqlite",
        help="Path/connection string for catalog database"
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=Path("data"),
        help="Directory for DuckLake data files (default: data)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force setup even if catalog already exists"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging"
    )

    args = parser.parse_args()

    setup_logging(args.verbose)

    # Validate assets directory
    if not args.assets_dir.exists():
        logging.error(f"Assets directory not found: {args.assets_dir}")
        return 1

    # Check if catalog already exists
    if args.catalog_type == "sqlite":
        catalog_file = Path(args.catalog_path)
        if catalog_file.exists() and not args.force:
            logging.error(f"Catalog already exists: {catalog_file}. Use --force to overwrite")
            return 1

    try:
        # Create data directory
        args.data_path.mkdir(parents=True, exist_ok=True)

        # Setup DuckLake catalog
        logging.info("Setting up DuckLake...")
        ducklake_conn = setup_ducklake_catalog(
            args.catalog_type,
            args.catalog_path,
            args.data_path
        )

        # Create tables
        create_tables(ducklake_conn)

        # Load genetic data
        load_genetic_data(ducklake_conn, args.assets_dir)

        # Create initial snapshot
        create_initial_snapshot(ducklake_conn)

        # Verify setup
        if verify_setup(ducklake_conn):
            logging.info("✅ DuckLake setup completed successfully!")
            logging.info(f"Data directory: {args.data_path}")
            logging.info(f"Catalog database: {args.catalog_path}")

            # Show connection example
            if args.catalog_type == "sqlite":
                attach_example = f"ATTACH 'ducklake:sqlite:{args.catalog_path}' AS gorgonetics_lake (DATA_PATH '{args.data_path}')"
            elif args.catalog_type == "duckdb":
                attach_example = f"ATTACH 'ducklake:{args.catalog_path}' AS gorgonetics_lake"
            else:
                attach_example = f"ATTACH 'ducklake:{args.catalog_type}:{args.catalog_path}' AS gorgonetics_lake (DATA_PATH '{args.data_path}')"

            logging.info(f"To connect: {attach_example}")

            # Show environment variables
            logging.info("\nEnvironment variables for your app:")
            logging.info(f"GORGONETICS_DB_BACKEND=ducklake")
            logging.info(f"GORGONETICS_CATALOG_TYPE={args.catalog_type}")
            logging.info(f"GORGONETICS_CATALOG_PATH={args.catalog_path}")
            logging.info(f"GORGONETICS_DATA_PATH={args.data_path}")

            return 0
        else:
            logging.error("❌ Setup verification failed!")
            return 1

    except Exception as e:
        logging.error(f"Setup failed: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1

    finally:
        try:
            ducklake_conn.close()
        except:
            pass


if __name__ == "__main__":
    sys.exit(main())
