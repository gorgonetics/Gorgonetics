#!/usr/bin/env python3
"""
Database population script for Gorgonetics.

This script reads the JSON gene template files and populates the DuckDB database.
Run this script whenever you want to refresh the database with the latest JSON data.
"""

import json
import logging
import sys
from pathlib import Path

from rich.console import Console
from rich.logging import RichHandler
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent / "src"))

from gorgonetics.database_config import create_database_instance
from typing import Any

# Setup rich console and logging
console = Console()
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(console=console, rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)


def load_gene_file(file_path: Path, animal_type: str, chr_num: str, db: Any, progress, file_task) -> int:
    """Load genes from a single JSON file into the database."""
    genes_loaded = 0

    with open(file_path, encoding="utf-8") as f:
        genes_data = json.load(f)

    for gene_data in genes_data:
        # Handle both old and new JSON structure
        effect_dominant = gene_data.get("effectDominant") or gene_data.get("effect", "None")
        effect_recessive = gene_data.get("effectRecessive", "None")

        # If using old structure with single effect + trigger
        if "trigger" in gene_data and "effectDominant" not in gene_data:
            trigger = gene_data.get("trigger", "").lower()
            if trigger == "dominant":
                effect_dominant = gene_data.get("effect", "None")
                effect_recessive = "None"
            elif trigger == "recessive":
                effect_dominant = "None"
                effect_recessive = gene_data.get("effect", "None")

        # Insert gene into database using proper method with timestamps
        gene_record = {
            "effect_dominant": effect_dominant,
            "effect_recessive": effect_recessive,
            "appearance": gene_data.get("appearance", "|String for me to fill in|"),
            "notes": gene_data.get("notes", "|String for me to fill in|"),
        }
        db._upsert_gene(animal_type, chr_num, gene_data["gene"], gene_record)

        genes_loaded += 1
        progress.advance(file_task)

    return genes_loaded


def get_animal_type_from_filename(filename: str) -> str:
    """Determine animal type from filename."""
    if "beewasp" in filename:
        return "beewasp"
    elif "horse" in filename:
        return "horse"
    else:
        return ""


def collect_gene_files() -> list[Path]:
    """Collect all gene files from assets directories."""
    beewasp_dir = Path("assets/beewasp")
    horse_dir = Path("assets/horse")

    files_to_process: list[Path] = []
    if beewasp_dir.exists():
        files_to_process.extend(sorted(beewasp_dir.glob("beewasp_genes_chr*.json")))
    if horse_dir.exists():
        files_to_process.extend(sorted(horse_dir.glob("horse_genes_chr*.json")))

    return files_to_process


def populate_database() -> None:
    """Populate the database with gene data from JSON files."""
    console.print("🧬 [bold cyan]Gorgonetics Database Population[/bold cyan]")
    console.print("=" * 50)

    try:
        # Initialize database
        console.print("📊 [yellow]Connecting to database...[/yellow]")
        db = create_database_instance()

        # Clear existing data
        console.print("🗑️  [red]Clearing existing gene data...[/red]")
        db.conn.execute("DELETE FROM genes")
        db.conn.commit()

        # Count total files to process
        files_to_process = collect_gene_files()

        if not files_to_process:
            console.print("[red]❌ No gene files found in assets directory![/red]")
            return

        total_genes = 0

        # Create progress bar
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            # Add overall task
            overall_task = progress.add_task("[cyan]Processing gene files...", total=len(files_to_process))

            for file_path in files_to_process:
                # Determine animal type and chromosome
                animal_type = get_animal_type_from_filename(file_path.name)
                if not animal_type:
                    continue

                chr_num = file_path.stem.split("_chr")[1]

                progress.update(overall_task, description=f"[cyan]Loading {animal_type} chr{chr_num}...")

                try:
                    with open(file_path, encoding="utf-8") as f:
                        genes_data = json.load(f)

                    # Add task for this file's genes
                    file_task = progress.add_task("[green]  Processing genes...", total=len(genes_data))

                    genes_loaded = load_gene_file(file_path, animal_type, chr_num, db, progress, file_task)
                    total_genes += genes_loaded

                    progress.remove_task(file_task)

                except Exception as e:
                    console.print(f"[red]   ❌ Error loading {file_path}: {e}[/red]")

                progress.advance(overall_task)

        # Summary
        console.print("=" * 50)
        console.print(f"🎉 [bold green]Successfully loaded {total_genes} genes into database![/bold green]")

        # Show animal type summary
        animal_types = db.get_animal_types()
        for animal_type in animal_types:
            gene_count = len(db.get_genes_for_animal(animal_type))
            console.print(f"📋 [blue]{animal_type.title()}:[/blue] {gene_count} genes")

        db.close()
        console.print("\n✨ [bold]Database population completed![/bold]")
        console.print("🚀 [dim]You can now start the web application with:[/dim] [bold]python run_web_app.py[/bold]")

    except Exception as e:
        console.print(f"[red]❌ Error populating database: {e}[/red]")
        sys.exit(1)


def main() -> None:
    """Main function."""
    populate_database()


if __name__ == "__main__":
    main()
