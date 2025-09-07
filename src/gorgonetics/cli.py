"""Command line interface for Gorgonetics."""

import json
from pathlib import Path
from typing import Any

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

from gorgonetics import __version__

from .database_config import create_database_instance, get_database_config
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
def web(
    host: str = typer.Option("127.0.0.1", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to bind to"),
    reload: bool = typer.Option(True, help="Enable auto-reload in development"),
) -> None:
    """Start the web application server."""
    console.print("* [green]Starting Gorgonetics Web Application[/green]")
    console.print(f"* [blue]Open your browser to: http://{host}:{port}[/blue]")

    try:
        import uvicorn

        uvicorn.run("gorgonetics.web_app:app", host=host, port=port, reload=reload, log_level="info")
    except KeyboardInterrupt:
        console.print("\n* [yellow]Shutting down Gorgonetics Web Application[/yellow]")
    except ImportError:
        console.print("[red]Error: uvicorn not found. Install with: pip install uvicorn[/red]")
        raise typer.Exit(1) from None
    except Exception as e:
        console.print(f"[red]Error starting web server: {e}[/red]")
        raise typer.Exit(1) from e


def _load_gene_file(file_path: Path, animal_type: str, chr_num: str, db: Any, progress: Any, file_task: Any) -> int:
    """Load genes from a single JSON file into the database."""
    genes_loaded = 0

    with open(file_path, encoding="utf-8") as f:
        genes_data = json.load(f)

    for gene_data in genes_data:
        # Handle both old and new JSON structure
        effectDominant = gene_data.get("effectDominant") or gene_data.get("effect", "None")
        effectRecessive = gene_data.get("effectRecessive", "None")

        # If using old structure with single effect + trigger
        if "trigger" in gene_data and "effectDominant" not in gene_data:
            trigger = gene_data.get("trigger", "").lower()
            if trigger == "dominant":
                effectDominant = gene_data.get("effect", "None")
                effectRecessive = "None"
            elif trigger == "recessive":
                effectDominant = "None"
                effectRecessive = gene_data.get("effect", "None")

        # Insert gene into database using proper method with timestamps
        gene_record = {
            "effectDominant": effectDominant,
            "effectRecessive": effectRecessive,
            "appearance": gene_data.get("appearance", "|String for me to fill in|"),
            "notes": gene_data.get("notes", "|String for me to fill in|"),
        }
        db._upsert_gene(animal_type, chr_num, gene_data["gene"], gene_record)

        genes_loaded += 1
        progress.advance(file_task)

    return genes_loaded


def _get_animal_type_from_filename(filename: str) -> str:
    """Determine animal type from filename."""
    if "beewasp" in filename:
        return "beewasp"
    elif "horse" in filename:
        return "horse"
    else:
        return ""


def _collect_gene_files() -> list[Path]:
    """Collect all gene files from assets directories."""
    beewasp_dir = Path("assets/beewasp")
    horse_dir = Path("assets/horse")

    files_to_process: list[Path] = []
    if beewasp_dir.exists():
        files_to_process.extend(sorted(beewasp_dir.glob("beewasp_genes_chr*.json")))
    if horse_dir.exists():
        files_to_process.extend(sorted(horse_dir.glob("horse_genes_chr*.json")))

    return files_to_process


@app.command()
def populate() -> None:
    """Populate database with gene data from asset files."""
    console.print("* [green]Populating Gorgonetics Database[/green]")
    console.print("[blue]Loading gene data from assets directory[/blue]")
    console.print("* [bold cyan]Gorgonetics Database Population[/bold cyan]")
    console.print("=" * 50)

    try:
        # Initialize database
        console.print("* [yellow]Connecting to database...[/yellow]")
        db = create_database_instance()

        # Clear existing data
        console.print("* [red]Clearing existing gene data...[/red]")
        if db.conn is not None:
            db.conn.execute("DELETE FROM genes")
            db.conn.commit()
        else:
            console.print("* [red]Error: Database connection is None[/red]")
            raise typer.Exit(1)

        # Collect files to process
        files_to_process = _collect_gene_files()

        if not files_to_process:
            console.print("[yellow]* No gene files found in assets directories![/yellow]")
            console.print("[dim]Expected files in:[/dim]")
            console.print("  - assets/beewasp/beewasp_genes_chr*.json")
            console.print("  - assets/horse/horse_genes_chr*.json")
            return

        total_genes = 0

        # Process files with progress tracking
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            overall_task = progress.add_task("[cyan]Processing gene files...", total=len(files_to_process))

            for file_path in files_to_process:
                # Determine animal type and chromosome
                animal_type = _get_animal_type_from_filename(file_path.name)
                if not animal_type:
                    continue

                chr_num = file_path.stem.split("_chr")[1]

                progress.update(overall_task, description=f"[cyan]Loading {animal_type} chr{chr_num}...")

                try:
                    with open(file_path, encoding="utf-8") as f:
                        genes_data = json.load(f)

                    # Add task for this file's genes
                    file_task = progress.add_task("[green]  Processing genes...", total=len(genes_data))

                    genes_loaded = _load_gene_file(file_path, animal_type, chr_num, db, progress, file_task)
                    total_genes += genes_loaded

                    progress.remove_task(file_task)

                except Exception as e:
                    console.print(f"[red]   * Error loading {file_path}: {e}[/red]")

                progress.advance(overall_task)

        # Commit all changes to database
        console.print("[blue]* Committing changes to database...[/blue]")
        if db.conn is not None:
            db.conn.commit()
        else:
            console.print("* [red]Error: Database connection is None[/red]")
            raise typer.Exit(1)

        # Summary
        console.print("=" * 50)
        console.print(f"* [bold green]Successfully loaded {total_genes} genes into database![/bold green]")

        # Show animal type summary
        animal_types = db.get_animal_types()
        for animal_type in animal_types:
            gene_count = len(db.get_genes_for_animal(animal_type))
            console.print(f"* [blue]{animal_type.title()}:[/blue] {gene_count} genes")

        db.close()
        console.print("\n* [bold]Database population completed![/bold]")
        console.print("* [dim]You can now start the web application with:[/dim] [bold]uv run gorgonetics web[/bold]")
        console.print("* [green]Database population completed![/green]")

    except Exception as e:
        console.print(f"[red]* Error populating database: {e}[/red]")
        raise typer.Exit(1) from e


@app.command()
def db_status() -> None:
    """Show current database configuration and status."""
    config = get_database_config()

    table = Table(title="Database Configuration")
    table.add_column("Setting", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Backend", "DuckLake")
    table.add_row("Multi-user capable", "Yes" if config.is_multi_user_capable else "No")
    table.add_row("Catalog type", "SQLite")
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
            console.print(f"  * {error}")


@app.command()
def db_snapshots() -> None:
    """Show DuckLake snapshots."""
    config = get_database_config()

    try:
        db = DuckLakeGeneDatabase(
            catalog_type="sqlite",
            catalog_path=config.catalog_path,
            data_path=config.data_path,
            ducklake_name=config.ducklake_name,
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
                changes_str,
            )

        console.print(table)

    except Exception as e:
        console.print(f"[red]Failed to get snapshots: {e}[/red]")
        raise typer.Exit(1) from e


@app.command()
def db_cleanup(dry_run: bool = typer.Option(True, help="Perform dry run without actual cleanup")) -> None:
    """Clean up old DuckLake files."""
    config = get_database_config()

    try:
        db = DuckLakeGeneDatabase(
            catalog_type="sqlite",
            catalog_path=config.catalog_path,
            data_path=config.data_path,
            ducklake_name=config.ducklake_name,
        )

        if dry_run:
            console.print("[yellow]Performing dry run (no files will be deleted)[/yellow]")
        else:
            console.print("[red]Performing actual cleanup[/red]")

        success = db.cleanup_old_files(dry_run=dry_run)

        if success:
            console.print("[green]* Cleanup completed successfully[/green]")
        else:
            console.print("[red]* Cleanup failed[/red]")

    except Exception as e:
        console.print(f"[red]Failed to cleanup: {e}[/red]")
        raise typer.Exit(1) from e


@app.command()
def clean_test_artifacts(
    dry_run: bool = typer.Option(False, help="Show what would be removed without actually removing it"),
) -> None:
    """Clean up test artifacts and temporary files."""
    import shutil
    from pathlib import Path

    # Define test artifacts to clean up
    artifacts = [
        "test_client_metadata.sqlite",
        "test_client_data/",
        ".pytest_cache/",
        "test-results/",
        ".mypy_cache/",
        ".ruff_cache/",
        "htmlcov/",
        ".coverage",
        "*.db",  # Any loose database files
        "test_*.db",
        "test_*.sqlite",
        "__pycache__/",
        "**/__pycache__/",
    ]

    console.print("* [blue]Cleaning up test artifacts...[/blue]")

    if dry_run:
        console.print("* [yellow]DRY RUN: Showing what would be removed[/yellow]")

    cleaned_count = 0

    for artifact in artifacts:
        if "*" in artifact:
            # Handle glob patterns
            from glob import glob

            matches = glob(artifact, recursive=True)
            for match in matches:
                path = Path(match)
                if path.exists():
                    if dry_run:
                        console.print(f"  Would remove: {match}")
                    else:
                        try:
                            if path.is_file():
                                path.unlink()
                                console.print(f"  Removed file: {match}")
                            elif path.is_dir():
                                shutil.rmtree(path)
                                console.print(f"  Removed directory: {match}")
                            cleaned_count += 1
                        except Exception as e:
                            console.print(f"  [red]Failed to remove {match}: {e}[/red]")
        else:
            path = Path(artifact)
            if path.exists():
                if dry_run:
                    console.print(f"  Would remove: {artifact}")
                else:
                    try:
                        if path.is_file():
                            path.unlink()
                            console.print(f"  Removed file: {artifact}")
                        elif path.is_dir():
                            shutil.rmtree(path)
                            console.print(f"  Removed directory: {artifact}")
                        cleaned_count += 1
                    except Exception as e:
                        console.print(f"  [red]Failed to remove {artifact}: {e}[/red]")

    if dry_run:
        console.print("* [yellow]Dry run completed. Use --no-dry-run to actually remove files.[/yellow]")
    else:
        if cleaned_count > 0:
            console.print(f"* [green]Cleanup completed! Removed {cleaned_count} artifacts.[/green]")
        else:
            console.print("* [green]No test artifacts found to clean up.[/green]")


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


@app.command()
def create_admin(
    username: str = typer.Option(..., help="Admin username"),
    email: str = typer.Option(..., help="Admin email"),
    password: str = typer.Option(..., help="Admin password"),
) -> None:
    """Create an admin user for initial setup."""
    try:
        from .auth import get_password_hash
        from .auth.models import UserCreate

        # Create user data
        user_data = UserCreate(username=username, email=email, password=password)
        password_hash = get_password_hash(password)

        # Connect to database and create admin user
        db = create_database_instance()
        try:
            # Get next available user ID
            from datetime import datetime

            now = datetime.now()

            result = db.conn.execute("SELECT MAX(id) FROM users").fetchone()
            next_id = (result[0] or 0) + 1

            db.conn.execute(
                """INSERT INTO users (id, username, email, password_hash, role, is_active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'admin', true, ?, ?)""",
                (next_id, username, email, password_hash, now, now),
            )

            console.print(f"[green]* Successfully created admin user: {username}[/green]")
            console.print("[blue]* You can now log in to the web interface with these credentials[/blue]")

        except Exception as e:
            console.print(f"[red]Failed to create admin user: {e}[/red]")
            raise typer.Exit(1) from e
        finally:
            db.close()

    except Exception as e:
        console.print(f"[red]Error creating admin user: {e}[/red]")
        raise typer.Exit(1) from e


if __name__ == "__main__":
    app()
