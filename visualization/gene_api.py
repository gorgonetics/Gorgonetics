#!/usr/bin/env python3
"""
Simple API server to provide gene effects data for the visualization component.
This serves as a bridge between the HTML frontend and the PGBreeder database.
"""

# Add the parent directory to the path to import pgbreeder modules
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

sys.path.append(str(Path(__file__).parent.parent / "src"))

from pgbreeder.database import GeneDatabase

# Global database instance
db: GeneDatabase | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Startup
    global db
    db = GeneDatabase()
    yield
    # Shutdown
    if db:
        db.close()


app = FastAPI(title="PGBreeder Gene Visualization API", version="1.0.0", lifespan=lifespan)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (HTML, CSS, JS)
app.mount("/static", StaticFiles(directory=Path(__file__).parent), name="static")


def get_database() -> GeneDatabase:
    """Get or create database connection."""
    global db
    if db is None:
        db = GeneDatabase()
    return db


@app.get("/")
async def serve_visualization():
    """Serve the main visualization page."""
    html_path = Path(__file__).parent / "gene_viewer.html"
    return FileResponse(html_path)


@app.get("/api/species")
async def get_species() -> dict[str, Any]:
    """Get available species from the database."""
    try:
        database = get_database()
        species = database.get_animal_types()
        return {"species": species}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/chromosomes/{species}")
async def get_chromosomes(species: str) -> dict[str, Any]:
    """Get available chromosomes for a species."""
    try:
        database = get_database()
        chromosomes = database.get_chromosomes(species.lower())
        return {"chromosomes": chromosomes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/genes/{species}")
async def get_all_gene_effects(species: str) -> dict[str, Any]:
    """Get all gene effects for a species."""
    try:
        database = get_database()

        # Normalize species name
        species_key = species.lower()
        if species_key == "horse":
            species_key = "horse"
        elif species_key in ["bee", "beewasp", "wasp"]:
            species_key = "beewasp"

        all_effects = {}

        # Get all chromosomes for this species
        chromosomes = database.get_chromosomes(species_key)

        for chromosome in chromosomes:
            genes = database.get_genes_by_chromosome(species_key, chromosome)
            for gene_data in genes:
                gene_id = gene_data["gene"]
                all_effects[gene_id] = {
                    "effectDominant": gene_data.get("effectDominant"),
                    "effectRecessive": gene_data.get("effectRecessive"),
                    "appearance": gene_data.get("appearance", ""),
                    "notes": gene_data.get("notes", ""),
                }

        return {"effects": all_effects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/genes/{species}/{chromosome}")
async def get_chromosome_gene_effects(species: str, chromosome: str) -> dict[str, Any]:
    """Get gene effects for a specific chromosome."""
    try:
        database = get_database()

        # Normalize species name
        species_key = species.lower()
        if species_key == "horse":
            species_key = "horse"
        elif species_key in ["bee", "beewasp", "wasp"]:
            species_key = "beewasp"

        # Normalize chromosome (ensure 2-digit format)
        chromosome_key = chromosome.zfill(2)

        genes = database.get_genes_by_chromosome(species_key, chromosome_key)

        effects = {}
        for gene_data in genes:
            gene_id = gene_data["gene"]
            effects[gene_id] = {
                "effectDominant": gene_data.get("effectDominant"),
                "effectRecessive": gene_data.get("effectRecessive"),
                "appearance": gene_data.get("appearance", ""),
                "notes": gene_data.get("notes", ""),
            }

        return {"effects": effects}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/gene/{species}/{gene_id}")
async def get_single_gene_effect(species: str, gene_id: str) -> dict[str, Any]:
    """Get effects for a single gene."""
    try:
        database = get_database()

        # Normalize species name
        species_key = species.lower()
        if species_key == "horse":
            species_key = "horse"
        elif species_key in ["bee", "beewasp", "wasp"]:
            species_key = "beewasp"

        gene_data = database.get_gene(species_key, gene_id)

        if not gene_data:
            raise HTTPException(status_code=404, detail=f"Gene {gene_id} not found for species {species}")

        return {
            "gene": gene_id,
            "effectDominant": gene_data.get("effectDominant"),
            "effectRecessive": gene_data.get("effectRecessive"),
            "appearance": gene_data.get("appearance", ""),
            "notes": gene_data.get("notes", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/pets")
async def get_all_pets() -> dict[str, Any]:
    """Get all pets from the database."""
    try:
        database = get_database()
        pets = database.get_all_pets()

        pet_list = []
        for pet in pets:
            pet_list.append(
                {
                    "name": pet.name,
                    "species": pet.genome.genome_type,
                    "owner": pet.genome.breeder,
                    "format": pet.genome.format_version,
                }
            )

        return {"pets": pet_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


@app.get("/api/pet/{pet_name}")
async def get_pet_genome(pet_name: str) -> dict[str, Any]:
    """Get genome data for a specific pet."""
    try:
        database = get_database()
        pet = database.get_pet(pet_name)

        if not pet:
            raise HTTPException(status_code=404, detail=f"Pet {pet_name} not found")

        # Convert genome to the format expected by the frontend
        genome_data = {}
        for chromosome, genes in pet.genome.genes.items():
            gene_string = ""
            current_block = ""
            current_block_genes = ""

            for gene in genes:
                if gene.block != current_block:
                    if current_block_genes:
                        gene_string += current_block_genes + " "
                    current_block = gene.block
                    current_block_genes = ""

                current_block_genes += gene.gene_type.value

            # Add the last block
            if current_block_genes:
                gene_string += current_block_genes

            genome_data[chromosome] = gene_string.strip()

        return {
            "name": pet.name,
            "owner": pet.genome.breeder,
            "species": pet.genome.genome_type,
            "format": pet.genome.format_version,
            "genes": genome_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}") from e


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("gene_api:app", host="localhost", port=8000, reload=True)
