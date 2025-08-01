"""Command line interface for Gorgonetics."""

import typer
from rich.console import Console

from gorgonetics import __version__

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
    """A simple CLI application."""
    pass


if __name__ == "__main__":
    app()
