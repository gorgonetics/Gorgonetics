"""
Web API for PGBreeder gene editing interface.

This module provides a FastAPI web application for managing gene data
through a web interface with DuckDB backend.
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .database import GeneDatabase

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="PGBreeder Gene Editor", version="1.0.0")

# Initialize database
db = GeneDatabase()

# Initialize templates
templates = Jinja2Templates(directory="src/pgbreeder/templates")

# Mount static files
app.mount("/static", StaticFiles(directory="src/pgbreeder/static"), name="static")


class GeneUpdate(BaseModel):
    """Model for gene update requests."""

    animal_type: str
    gene: str
    effect_dominant: str | None = None
    effect_recessive: str | None = None
    appearance: str | None = None
    notes: str | None = None


@app.on_event("startup")
async def startup_event() -> None:
    """Initialize the application."""
    try:
        # Run migration to update Cleverness to Intelligence
        db.migrate_cleverness_to_intelligence()

        # Just verify database connection, don't load data
        animal_types = db.get_animal_types()
        if animal_types:
            logger.info(f"Database connected successfully. Found {len(animal_types)} animal types.")
        else:
            logger.warning("Database is empty. Run 'python populate_database.py' to load gene data.")
    except Exception as e:
        logger.warning(f"Database connection issue: {e}. Make sure to run 'python populate_database.py' first.")


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    """Serve the main gene editor page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/animal-types")
async def get_animal_types() -> list[str]:
    """Get list of available animal types."""
    try:
        return db.get_animal_types()
    except Exception as e:
        logger.error(f"Error getting animal types: {e}")
        raise HTTPException(status_code=500, detail="Failed to get animal types") from e


@app.get("/api/chromosomes/{animal_type}")
async def get_chromosomes(animal_type: str) -> list[str]:
    """Get list of chromosomes for an animal type."""
    try:
        return db.get_chromosomes(animal_type)
    except Exception as e:
        logger.error(f"Error getting chromosomes for {animal_type}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get chromosomes") from e


@app.get("/api/genes/{animal_type}/{chromosome}")
async def get_genes(animal_type: str, chromosome: str) -> list[dict]:
    """Get all genes for a specific chromosome."""
    try:
        return db.get_genes_by_chromosome(animal_type, chromosome)
    except Exception as e:
        logger.error(f"Error getting genes for {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get genes") from e


@app.get("/api/gene/{animal_type}/{gene}")
async def get_gene(animal_type: str, gene: str) -> dict:
    """Get a specific gene."""
    try:
        gene_data = db.get_gene(animal_type, gene)
        if gene_data is None:
            raise HTTPException(status_code=404, detail="Gene not found")
        return gene_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting gene {animal_type}/{gene}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get gene") from e


@app.put("/api/gene")
async def update_gene(gene_update: GeneUpdate) -> dict[str, str]:
    """Update a gene's data."""
    try:
        success = db.update_gene(
            animal_type=gene_update.animal_type,
            gene=gene_update.gene,
            effect_dominant=gene_update.effect_dominant,
            effect_recessive=gene_update.effect_recessive,
            appearance=gene_update.appearance,
            notes=gene_update.notes,
        )

        if success:
            return {"status": "success", "message": "Gene updated successfully"}
        else:
            raise HTTPException(status_code=400, detail="Failed to update gene")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating gene: {e}")
        raise HTTPException(status_code=500, detail="Failed to update gene") from e


@app.get("/api/effect-options")
async def get_effect_options() -> list[str]:
    """Get list of possible effect values for dropdown."""
    # You mentioned you'll provide these values later
    # For now, I'll include some common ones based on the data I saw
    effects = [
        "None",
        "Toughness+",
        "Toughness-",
        "Friendliness+",
        "Friendliness-",
        "Ruggedness+",
        "Ruggedness-",
        "Ferocity+",
        "Ferocity-",
        "Enthusiasm+",
        "Enthusiasm-",
        "Virility+",
        "Virility-",
        "Speed+",
        "Speed-",
        "Intelligence+",
        "Intelligence-",
        "Loyalty+",
        "Loyalty-",
    ]
    return sorted(effects)


def run_server() -> None:
    """Run the development server."""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    run_server()
