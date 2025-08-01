"""
Web API for Gorgonetics gene editing interface.

This module provides a FastAPI web application for managing gene data
through a web interface with DuckDB backend.
"""

import hashlib
import logging
import os
import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .database import GeneDatabase


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan handler."""
    # Startup
    try:
        # Just verify database connection, don't load data
        animal_types = db.get_animal_types()
        if animal_types:
            logger.info(f"Database connected successfully. Found {len(animal_types)} animal types.")
        else:
            logger.warning("Database is empty. Run 'python populate_database.py' to load gene data.")
    except Exception as e:
        logger.warning(f"Database connection issue: {e}. Make sure to run 'python populate_database.py' first.")

    yield

    # Shutdown (nothing needed for now)


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app with lifespan
app = FastAPI(title="Gorgonetics Gene Editor", version="1.0.0", lifespan=lifespan)

# Initialize database
db = GeneDatabase()

# Initialize templates
templates = Jinja2Templates(directory="src/gorgonetics/templates")

# Mount static files
app.mount("/static", StaticFiles(directory="src/gorgonetics/static"), name="static")




class GeneUpdate(BaseModel):
    """Model for gene update requests."""

    animal_type: str
    gene: str
    effect_dominant: str | None = None
    effect_recessive: str | None = None
    appearance: str | None = None
    notes: str | None = None


class PetCreate(BaseModel):
    """Model for creating a new pet."""

    name: str
    intelligence: float = 50.0
    toughness: float = 50.0
    notes: str | None = None


class PetUpdate(BaseModel):
    """Model for updating pet attributes."""

    name: str | None = None
    intelligence: float | None = None
    toughness: float | None = None
    friendliness: float | None = None
    ruggedness: float | None = None
    ferocity: float | None = None
    enthusiasm: float | None = None
    virility: float | None = None
    notes: str | None = None


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    """Serve the main gene editor page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/gene-effects/{species}")
async def get_gene_effects(species: str) -> dict[str, Any]:
    """Get all gene effects for visualization component."""
    try:
        # Normalize species name
        species_key = species.lower()
        if species_key == "horse":
            species_key = "horse"
        elif species_key in ["bee", "beewasp", "wasp"]:
            species_key = "beewasp"

        all_effects = {}

        # Get all chromosomes for this species
        chromosomes = db.get_chromosomes(species_key)

        for chromosome in chromosomes:
            genes = db.get_genes_by_chromosome(species_key, chromosome)
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
        logger.error(f"Error getting gene effects for {species}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get gene effects") from e


@app.get("/api/pet-genome/{pet_id}")
async def get_pet_genome_for_visualization(pet_id: int) -> dict[str, Any]:
    """Get pet genome data formatted for visualization."""
    try:
        pet_data = db.get_pet(pet_id)
        if not pet_data:
            raise HTTPException(status_code=404, detail="Pet not found")

        # Parse the genome JSON
        import json

        from .models import Genome

        genome_json = json.loads(pet_data["genome_data"])
        genome = Genome.from_dict(genome_json)

        # Convert genome to the format expected by the frontend
        genome_data = {}
        for chromosome, genes in genome.genes.items():
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
            "name": pet_data["name"],
            "owner": genome.breeder,
            "species": genome.genome_type,
            "format": genome.format_version,
            "genes": genome_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pet genome for visualization {pet_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pet genome") from e


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
async def get_genes(animal_type: str, chromosome: str) -> list[dict[str, str | int]]:
    """Get all genes for a specific chromosome."""
    try:
        return db.get_genes_by_chromosome(animal_type, chromosome)
    except Exception as e:
        logger.error(f"Error getting genes for {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get genes") from e


@app.get("/api/gene/{animal_type}/{gene}")
async def get_gene(animal_type: str, gene: str) -> dict[str, str | int | None]:
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
        "Intelligence+",
        "Intelligence-",
    ]
    return sorted(effects)


@app.get("/api/export/{animal_type}")
async def export_all_chromosomes(animal_type: str) -> dict[str, str | list[str]]:
    """Export all chromosomes for an animal type to JSON files."""
    try:
        exported_files = db.export_all_animal_chromosomes(animal_type, "exports")
        return {"status": "success", "files": exported_files}
    except Exception as e:
        logger.error(f"Error exporting chromosomes for {animal_type}: {e}")
        raise HTTPException(status_code=500, detail="Failed to export chromosomes") from e


@app.get("/api/export/{animal_type}/{chromosome}")
async def export_chromosome_json(animal_type: str, chromosome: str) -> dict[str, str]:
    """Export a specific chromosome to JSON format."""
    try:
        json_data = db.export_genes_to_json(animal_type, chromosome)
        return {"status": "success", "data": json_data}
    except Exception as e:
        logger.error(f"Error exporting {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=500, detail="Failed to export chromosome") from e


@app.get("/api/download/{animal_type}/{chromosome}")
async def download_chromosome_file(animal_type: str, chromosome: str) -> Response:
    """Download a chromosome JSON file."""
    try:
        json_data = db.export_genes_to_json(animal_type, chromosome)
        filename = f"{animal_type}_genes_chr{chromosome}.json"

        return Response(
            content=json_data,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error(f"Error downloading {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=500, detail="Failed to download file") from e


# Pet Management Endpoints


@app.post("/api/pets/upload")
async def upload_pet_genome(
    file: UploadFile = File(...),
    name: str = "",  # Optional override name
    intelligence: float = 50.0,
    toughness: float = 50.0,
    friendliness: float = 50.0,
    ruggedness: float = 50.0,
    ferocity: float = 50.0,
    enthusiasm: float = 50.0,
    virility: float = 50.0,
    notes: str | None = None,
) -> dict[str, str | int]:
    """Upload a genome file and create a new pet."""
    try:
        # Read the uploaded file content
        content = await file.read()

        # Compute SHA-256 hash of file content
        content_hash = hashlib.sha256(content).hexdigest()

        # Check if this exact file was already uploaded
        existing_pet = db.find_pet_by_hash(content_hash)
        if existing_pet:
            raise HTTPException(
                status_code=409,
                detail=f"This file has already been uploaded as '{existing_pet['name']}' on {existing_pet['created_at']}",
            )

        # Decode content as text
        try:
            genome_content = content.decode("utf-8")
        except UnicodeDecodeError as e:
            raise HTTPException(status_code=400, detail="File must be a valid text file") from e

        # Parse the genome using our models
        from .models import Genome

        # Create a temporary file to use with our existing parser
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt") as temp_file:
            temp_file.write(genome_content)
            temp_file_path = temp_file.name

        try:
            # Parse the genome
            genome = Genome.from_file(temp_file_path)

            # Use the pet name from the genome file, or user override, or filename as fallback
            pet_name = (
                genome.name.strip()
                if genome.name.strip()
                else (
                    name.strip()
                    if name.strip()
                    else file.filename.replace(".txt", "")
                    if file.filename
                    else "Unknown Pet"
                )
            )

            # Create the pet in the database
            pet_id = db.add_pet(
                name=pet_name,
                species=genome.genome_type,
                breeder=genome.breeder,
                genome_data=genome.to_json(),
                content_hash=content_hash,
                intelligence=intelligence,
                toughness=toughness,
                friendliness=friendliness,
                ruggedness=ruggedness,
                ferocity=ferocity,
                enthusiasm=enthusiasm,
                virility=virility,
                notes=notes,
            )

            return {"status": "success", "message": "Pet created successfully", "pet_id": pet_id, "name": pet_name}

        finally:
            # Clean up temp file
            os.unlink(temp_file_path)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading pet genome: {e}")
        raise HTTPException(status_code=500, detail="Failed to create pet") from e


@app.get("/api/pets")
async def get_pets() -> list[dict[str, Any]]:
    """Get all pets."""
    try:
        pets = db.get_all_pets()
        # Convert datetime objects to strings and handle None values
        for pet in pets:
            if pet.get("created_at"):
                pet["created_at"] = pet["created_at"].isoformat()
            if pet.get("notes") is None:
                pet["notes"] = ""
        return pets
    except Exception as e:
        logger.error(f"Error getting pets: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pets") from e


@app.get("/api/pets/{pet_id}")
async def get_pet(pet_id: int) -> dict[str, Any]:
    """Get a specific pet by ID."""
    try:
        pet = db.get_pet(pet_id)
        if pet is None:
            raise HTTPException(status_code=404, detail="Pet not found")

        # Convert datetime objects to strings and handle None values
        if pet.get("created_at"):
            pet["created_at"] = pet["created_at"].isoformat()
        if pet.get("updated_at"):
            pet["updated_at"] = pet["updated_at"].isoformat()
        if pet.get("notes") is None:
            pet["notes"] = ""

        return pet
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pet {pet_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pet") from e


@app.put("/api/pets/{pet_id}")
async def update_pet(pet_id: int, pet_update: PetUpdate) -> dict[str, str]:
    """Update a pet's attributes."""
    try:
        success = db.update_pet(
            pet_id=pet_id,
            name=pet_update.name,
            intelligence=pet_update.intelligence,
            toughness=pet_update.toughness,
            friendliness=pet_update.friendliness,
            ruggedness=pet_update.ruggedness,
            ferocity=pet_update.ferocity,
            enthusiasm=pet_update.enthusiasm,
            virility=pet_update.virility,
            notes=pet_update.notes,
        )

        if success:
            return {"status": "success", "message": "Pet updated successfully"}
        else:
            raise HTTPException(status_code=404, detail="Pet not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating pet {pet_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update pet") from e


@app.delete("/api/pets/{pet_id}")
async def delete_pet(pet_id: int) -> dict[str, str]:
    """Delete a pet."""
    try:
        success = db.delete_pet(pet_id)

        if success:
            return {"status": "success", "message": "Pet deleted successfully"}
        else:
            raise HTTPException(status_code=404, detail="Pet not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting pet {pet_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete pet") from e


@app.get("/api/pets/species/{species}")
async def get_pets_by_species(species: str) -> list[dict[str, str | int | float]]:
    """Get all pets of a specific species."""
    try:
        return db.get_pets_by_species(species)
    except Exception as e:
        logger.error(f"Error getting pets for species {species}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pets") from e


def run_server() -> None:
    """Run the development server."""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    run_server()
