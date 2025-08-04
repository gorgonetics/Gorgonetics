"""Command line interface for Gorgonetics."""

import typer
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn

from gorgonetics import __version__
from .database_config import get_database_config, DatabaseBackend
from .database import GeneDatabase
from .ducklake_database import DuckLakeGeneDatabase

console = Console()
app = typer.Typer(
    name="gorgonetics",
    help="Gorgon genetics breeding tool for Project Gorgon",
    add_completion=False,
)


def version_callback(value: bool) -> None:
    """Show version information."""
    if value:
        console.print(f"Gorgonetics version: {__version__}")
        raise typer.Exit()


@app.command()
def migrate_to_ducklake(
    source_db: str = typer.Option("gorgonetics.db", help="Source DuckDB file"),
    catalog_type: str = typer.Option("sqlite", help="Catalog type: sqlite, postgresql, mysql, duckdb"),
    catalog_path: str = typer.Option("metadata.sqlite", help="Catalog database path/connection"),
    data_path: str = typer.Option("data", help="Directory for Parquet data files"),
    backup_dir: str = typer.Option("backups", help="Directory for backups"),
    skip_backup: bool = typer.Option(False, help="Skip creating backup"),
) -> None:
    """Migrate existing DuckDB database to DuckLake format."""
    source_path = Path(source_db)

    if not source_path.exists():
        console.print(f"[red]Error: Source database not found: {source_path}[/red]")
        raise typer.Exit(1)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        # Import the migration script functionality
        import sys
        from pathlib import Path

        # Add scripts directory to path
        scripts_dir = Path(__file__).parent.parent.parent / "scripts"
        sys.path.insert(0, str(scripts_dir))

        from migrate_to_ducklake import (
            backup_existing_database,
            export_genes_to_parquet,
            setup_ducklake_catalog,
            migrate_genes_to_ducklake,
            migrate_pets_to_ducklake,
            create_initial_snapshot,
            verify_migration
        )

        try:
            # Create backup
            if not skip_backup:
                task = progress.add_task("Creating backup...", total=None)
                backup_path = backup_existing_database(source_path, Path(backup_dir))
                progress.update(task, description="✅ Backup created")

            # Export to Parquet
            task = progress.add_task("Exporting genes to Parquet...", total=None)
            data_dir = Path(data_path)
            data_dir.mkdir(parents=True, exist_ok=True)
            export_genes_to_parquet(source_path, data_dir)
            progress.update(task, description="✅ Genes exported")

            # Setup DuckLake
            task = progress.add_task("Setting up DuckLake catalog...", total=None)
            ducklake_conn = setup_ducklake_catalog(catalog_type, catalog_path, data_dir)
            progress.update(task, description="✅ DuckLake catalog ready")

            # Migrate data
            task = progress.add_task("Migrating data to DuckLake...", total=None)
            genes_dir = data_dir / "genes"
            migrate_genes_to_ducklake(ducklake_conn, genes_dir)
            migrate_pets_to_ducklake(source_path, ducklake_conn)
            progress.update(task, description="✅ Data migrated")

            # Create snapshot
            task = progress.add_task("Creating initial snapshot...", total=None)
            create_initial_snapshot(ducklake_conn)
            progress.update(task, description="✅ Snapshot created")

            # Verify
            task = progress.add_task("Verifying migration...", total=None)
            if verify_migration(ducklake_conn, source_path):
                progress.update(task, description="✅ Migration verified")
                console.print("\n[green]✅ Migration completed successfully![/green]")
                console.print(f"[blue]Data directory:[/blue] {data_dir}")
                console.print(f"[blue]Catalog database:[/blue] {catalog_path}")

                # Show connection example
                if catalog_type == "sqlite":
                    attach_example = f"ATTACH 'ducklake:sqlite:{catalog_path}' AS gorgonetics_lake (DATA_PATH '{data_dir}')"
                elif catalog_type == "duckdb":
                    attach_example = f"ATTACH 'ducklake:{catalog_path}' AS gorgonetics_lake"
                else:
                    attach_example = f"ATTACH 'ducklake:{catalog_type}:{catalog_path}' AS gorgonetics_lake (DATA_PATH '{data_dir}')"

                console.print(f"[blue]To connect:[/blue] {attach_example}")
            else:
                console.print("\n[red]❌ Migration verification failed![/red]")
                raise typer.Exit(1)

        except Exception as e:
            console.print(f"\n[red]Migration failed: {e}[/red]")
            raise typer.Exit(1)


@app.command()
def db_status() -> None:
    """Show current database configuration and status."""
    config = get_database_config()

    table = Table(title="Database Configuration")
    table.add_column("Setting", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Backend", config.backend.value)
    table.add_row("Multi-user capable", "Yes" if config.is_multi_user_capable else "No")

    if config.backend == DatabaseBackend.DUCKDB:
        table.add_row("Database path", config.duckdb_path)
        table.add_row("File exists", "Yes" if Path(config.duckdb_path).exists() else "No")
    else:
        table.add_row("Catalog type", config.catalog_type.value)
        table.add_row("Catalog path", config.catalog_path)
        table.add_row("Data path", config.data_path)
        table.add_row("DuckLake name", config.ducklake_name)
        table.add_row("Data directory exists", "Yes" if Path(config.data_path).exists() else "No")

    console.print(table)

    # Validate configuration
    errors = config.validate()
    if errors:
        console.print("\n[red]Configuration Errors:[/red]")
        for error in errors:
            console.print(f"  • {error}")


@app.command()
def db_snapshots() -> None:
    """Show DuckLake snapshots (DuckLake backend only)."""
    config = get_database_config()

    if config.backend != DatabaseBackend.DUCKLAKE:
        console.print("[red]Snapshots are only available with DuckLake backend[/red]")
        raise typer.Exit(1)

    try:
        db = DuckLakeGeneDatabase(
            catalog_type=config.catalog_type.value,
            catalog_path=config.catalog_path,
            data_path=config.data_path,
            ducklake_name=config.ducklake_name
        )

        snapshots = db.get_snapshots()

        if not snapshots:
            console.print("No snapshots found")
            return

        table = Table(title="DuckLake Snapshots")
        table.add_column("ID", style="cyan")
        table.add_column("Time", style="green")
        table.add_column("Schema Version", style="yellow")
        table.add_column("Changes", style="blue")

        for snapshot in snapshots:
            changes_str = str(snapshot.get("changes", ""))
            if len(changes_str) > 50:
                changes_str = changes_str[:47] + "..."

            table.add_row(
                str(snapshot["snapshot_id"]),
                str(snapshot["snapshot_time"]),
                str(snapshot["schema_version"]),
                changes_str
            )

        console.print(table)

    except Exception as e:
        console.print(f"[red]Failed to get snapshots: {e}[/red]")
        raise typer.Exit(1)


@app.command()
def db_cleanup(
    dry_run: bool = typer.Option(True, help="Perform dry run without actual cleanup")
) -> None:
    """Clean up old DuckLake files (DuckLake backend only)."""
    config = get_database_config()

    if config.backend != DatabaseBackend.DUCKLAKE:
        console.print("[red]Cleanup is only available with DuckLake backend[/red]")
        raise typer.Exit(1)

    try:
        db = DuckLakeGeneDatabase(
            catalog_type=config.catalog_type.value,
            catalog_path=config.catalog_path,
            data_path=config.data_path,
            ducklake_name=config.ducklake_name
        )

        if dry_run:
            console.print("[yellow]Performing dry run (no files will be deleted)[/yellow]")
        else:
            console.print("[red]Performing actual cleanup[/red]")

        success = db.cleanup_old_files(dry_run=dry_run)

        if success:
            console.print("[green]✅ Cleanup completed successfully[/green]")
        else:
            console.print("[red]❌ Cleanup failed[/red]")

    except Exception as e:
        console.print(f"[red]Failed to cleanup: {e}[/red]")
        raise typer.Exit(1)


@app.callback()
def main(
    version: bool = typer.Option(
        None,
        "--version",
        "-v",
        help="Show version information",
        callback=version_callback,
        is_eager=True,
    ),
) -> None:
    """Gorgon genetics breeding tool for Project Gorgon."""
    pass


if __name__ == "__main__":
    app()
