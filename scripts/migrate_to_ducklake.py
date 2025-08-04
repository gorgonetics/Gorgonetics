#!/usr/bin/env python3
"""
Migration script to convert existing DuckDB database to DuckLake format.

This script migrates the existing gorgonetics.db file to DuckLake format,
enabling multi-user support and advanced data lake features.
"""

import argparse
import logging
import shutil
import sys
from pathlib import Path

import duckdb


def setup_logging(verbose: bool = False) -> None:
    """Configure logging for the migration script."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )


def backup_existing_database(db_path: Path, backup_dir: Path) -> Path:
    """Create a backup of the existing database."""
    backup_dir.mkdir(exist_ok=True)
    backup_path = backup_dir / f"{db_path.name}.backup"

    if backup_path.exists():
        logging.warning(f"Backup already exists at {backup_path}")
        return backup_path

    logging.info(f"Creating backup: {db_path} -> {backup_path}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def export_genes_to_parquet(source_db: Path, output_dir: Path) -> None:
    """Export genes table to partitioned Parquet files."""
    genes_dir = output_dir / "genes"
    genes_dir.mkdir(parents=True, exist_ok=True)

    logging.info("Exporting genes table to Parquet format...")

    with duckdb.connect(str(source_db)) as conn:
        # Get list of animal types for partitioning
        animal_types = conn.execute("SELECT DISTINCT animal_type FROM genes ORDER BY animal_type").fetchall()

        for (animal_type,) in animal_types:
            logging.debug(f"Exporting genes for animal type: {animal_type}")

            # Create animal-specific directory
            animal_dir = genes_dir / animal_type
            animal_dir.mkdir(exist_ok=True)

            # Export genes for this animal type
            parquet_path = animal_dir / "genes.parquet"
            conn.execute(f"""
                COPY (
                    SELECT * FROM genes
                    WHERE animal_type = ?
                    ORDER BY chromosome, gene
                ) TO '{parquet_path}' (FORMAT PARQUET)
            """, [animal_type])

            logging.debug(f"Exported {animal_type} genes to {parquet_path}")


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
    conn.execute(f"""
        ATTACH '{attach_string}' AS gorgonetics_lake (DATA_PATH '{data_path}')
    """)
    conn.execute("USE gorgonetics_lake")

    return conn


def migrate_genes_to_ducklake(conn: duckdb.DuckDBPyConnection, genes_dir: Path) -> None:
    """Create genes table in DuckLake and load data from Parquet files."""
    logging.info("Creating genes table in DuckLake...")

    # Create genes table schema
    conn.execute("""
        CREATE TABLE IF NOT EXISTS genes (
            animal_type VARCHAR NOT NULL,
            chromosome VARCHAR NOT NULL,
            gene VARCHAR NOT NULL,
            effect_dominant VARCHAR DEFAULT 'None',
            effect_recessive VARCHAR DEFAULT 'None',
            appearance VARCHAR DEFAULT '|String for me to fill in|',
            notes VARCHAR DEFAULT '|String for me to fill in|',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (animal_type, gene)
        )
    """)

    # Load data from Parquet files
    animal_dirs = [d for d in genes_dir.iterdir() if d.is_dir()]

    for animal_dir in animal_dirs:
        animal_type = animal_dir.name
        parquet_file = animal_dir / "genes.parquet"

        if parquet_file.exists():
            logging.debug(f"Loading {animal_type} genes from {parquet_file}")
            conn.execute(f"""
                INSERT INTO genes
                SELECT * FROM read_parquet('{parquet_file}')
            """)
        else:
            logging.warning(f"No Parquet file found for {animal_type}")


def migrate_pets_to_ducklake(source_db: Path, conn: duckdb.DuckDBPyConnection) -> None:
    """Migrate pets table to DuckLake catalog."""
    logging.info("Migrating pets table to DuckLake...")

    with duckdb.connect(str(source_db)) as source_conn:
        # Get pets table schema
        pets_schema = source_conn.execute("DESCRIBE pets").fetchall()

        # Create pets table in DuckLake
        create_sql = "CREATE TABLE IF NOT EXISTS pets ("
        for i, (col_name, col_type, nullable, _, _, _) in enumerate(pets_schema):
            if i > 0:
                create_sql += ", "
            create_sql += f"{col_name} {col_type}"
            if not nullable:
                create_sql += " NOT NULL"
        create_sql += ")"

        conn.execute(create_sql)

        # Copy data from source to DuckLake
        pets_data = source_conn.execute("SELECT * FROM pets").fetchall()
        if pets_data:
            # Get column names for insert
            col_names = [col[0] for col in pets_schema]
            placeholders = ", ".join(["?" for _ in col_names])
            insert_sql = f"INSERT INTO pets ({', '.join(col_names)}) VALUES ({placeholders})"

            for row in pets_data:
                conn.execute(insert_sql, list(row))

            logging.info(f"Migrated {len(pets_data)} pets to DuckLake")


def create_initial_snapshot(conn: duckdb.DuckDBPyConnection) -> None:
    """Create the initial snapshot in DuckLake."""
    logging.info("Creating initial DuckLake snapshot...")

    # Force a commit to create the initial snapshot
    conn.commit()

    # Show snapshot information
    snapshots = conn.execute("FROM ducklake_snapshots('gorgonetics_lake')").fetchall()
    logging.info(f"Created {len(snapshots)} snapshot(s)")

    for snapshot in snapshots:
        logging.debug(f"Snapshot {snapshot[0]}: {snapshot[1]}")


def verify_migration(conn: duckdb.DuckDBPyConnection, source_db: Path) -> bool:
    """Verify that migration was successful."""
    logging.info("Verifying migration...")

    try:
        with duckdb.connect(str(source_db)) as source_conn:
            # Compare genes count
            source_genes = source_conn.execute("SELECT COUNT(*) FROM genes").fetchone()[0]
            ducklake_genes = conn.execute("SELECT COUNT(*) FROM genes").fetchone()[0]

            if source_genes != ducklake_genes:
                logging.error(f"Genes count mismatch: source={source_genes}, ducklake={ducklake_genes}")
                return False

            # Compare pets count
            source_pets = source_conn.execute("SELECT COUNT(*) FROM pets").fetchone()[0]
            ducklake_pets = conn.execute("SELECT COUNT(*) FROM pets").fetchone()[0]

            if source_pets != ducklake_pets:
                logging.error(f"Pets count mismatch: source={source_pets}, ducklake={ducklake_pets}")
                return False

            logging.info(f"Migration verified: {source_genes} genes, {source_pets} pets")
            return True

    except Exception as e:
        logging.error(f"Verification failed: {e}")
        return False


def main() -> int:
    """Main migration function."""
    parser = argparse.ArgumentParser(description="Migrate DuckDB to DuckLake format")
    parser.add_argument(
        "--source-db",
        type=Path,
        default=Path("gorgonetics.db"),
        help="Path to source DuckDB file (default: gorgonetics.db)"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data"),
        help="Output directory for DuckLake data (default: data)"
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
        "--backup-dir",
        type=Path,
        default=Path("backups"),
        help="Directory for database backups (default: backups)"
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Skip creating backup of source database"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging"
    )

    args = parser.parse_args()

    setup_logging(args.verbose)

    # Validate source database
    if not args.source_db.exists():
        logging.error(f"Source database not found: {args.source_db}")
        return 1

    try:
        # Create backup
        if not args.skip_backup:
            backup_existing_database(args.source_db, args.backup_dir)

        # Create output directories
        args.output_dir.mkdir(parents=True, exist_ok=True)

        # Export genes to Parquet
        export_genes_to_parquet(args.source_db, args.output_dir)

        # Setup DuckLake catalog
        ducklake_conn = setup_ducklake_catalog(
            args.catalog_type,
            args.catalog_path,
            args.output_dir
        )

        # Migrate data to DuckLake
        genes_dir = args.output_dir / "genes"
        migrate_genes_to_ducklake(ducklake_conn, genes_dir)
        migrate_pets_to_ducklake(args.source_db, ducklake_conn)

        # Create initial snapshot
        create_initial_snapshot(ducklake_conn)

        # Verify migration
        if verify_migration(ducklake_conn, args.source_db):
            logging.info("✅ Migration completed successfully!")
            logging.info(f"DuckLake data directory: {args.output_dir}")
            logging.info(f"Catalog database: {args.catalog_path}")

            # Show connection example
            if args.catalog_type == "sqlite":
                attach_example = f"ATTACH 'ducklake:sqlite:{args.catalog_path}' AS gorgonetics_lake (DATA_PATH '{args.output_dir}')"
            elif args.catalog_type == "duckdb":
                attach_example = f"ATTACH 'ducklake:{args.catalog_path}' AS gorgonetics_lake"
            else:
                attach_example = f"ATTACH 'ducklake:{args.catalog_type}:{args.catalog_path}' AS gorgonetics_lake (DATA_PATH '{args.output_dir}')"

            logging.info(f"To connect: {attach_example}")
            return 0
        else:
            logging.error("❌ Migration verification failed!")
            return 1

    except Exception as e:
        logging.error(f"Migration failed: {e}")
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
