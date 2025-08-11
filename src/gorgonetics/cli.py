"""Command line interface for Gorgonetics."""

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from gorgonetics import __version__

from .database_config import get_database_config
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
    console.print("🧬 [green]Starting Gorgonetics Web Application[/green]")
    console.print(f"🌐 [blue]Open your browser to: http://{host}:{port}[/blue]")

    try:
        import uvicorn
        uvicorn.run(
            "gorgonetics.web_app:app",
            host=host,
            port=port,
            reload=reload,
            log_level="info"
        )
    except KeyboardInterrupt:
        console.print("\n👋 [yellow]Shutting down Gorgonetics Web Application[/yellow]")
    except ImportError:
        console.print("[red]Error: uvicorn not found. Install with: pip install uvicorn[/red]")
        raise typer.Exit(1) from None
    except Exception as e:
        console.print(f"[red]Error starting web server: {e}[/red]")
        raise typer.Exit(1) from e


@app.command()
def populate() -> None:
    """Populate database with gene data from asset files."""
    console.print("🧬 [green]Populating Gorgonetics Database[/green]")

    try:
        import sys
        from pathlib import Path

        # Add scripts directory to path
        scripts_dir = Path(__file__).parent.parent.parent / "scripts"
        sys.path.insert(0, str(scripts_dir))

        try:
            from populate_database import main as populate_main
        except ImportError:
            console.print("[red]Error: populate_database script not found[/red]")
            raise typer.Exit(1) from None

        console.print("[blue]Loading gene data from assets directory[/blue]")
        populate_main()
        console.print("✅ [green]Database population completed![/green]")

    except Exception as e:
        console.print(f"[red]Error populating database: {e}[/red]")
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
            console.print(f"  • {error}")


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
            console.print("[green]✅ Cleanup completed successfully[/green]")
        else:
            console.print("[red]❌ Cleanup failed[/red]")

    except Exception as e:
        console.print(f"[red]Failed to cleanup: {e}[/red]")
        raise typer.Exit(1) from e


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
