"""
Web API for Gorgonetics gene editing interface.

This module provides a FastAPI web application for managing gene data
through a web interface with DuckDB backend.
"""

import hashlib
import json
import logging
import os
import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel

from .attribute_config import AttributeConfig
from .auth import User, UserCreate, UserLogin, Token, create_token_pair, verify_password, get_password_hash
from .auth.dependencies import get_current_user, get_current_active_user, require_admin, get_user_by_username, create_user_in_db
from .database_config import create_database_instance
from .models import Genome

if TYPE_CHECKING:
    from .ducklake_database import DuckLakeGeneDatabase


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan handler."""
    # Startup
    try:
        # Just verify database connection, don't load data
        test_db = create_database_instance()
        animal_types = test_db.get_animal_types()
        if animal_types:
            logger.info(f"Database connected successfully. Found {len(animal_types)} animal types.")
        else:
            logger.warning("Database is empty. Run 'python populate_database.py' to load gene data.")
        test_db.close()
    except Exception as e:
        logger.warning(f"Database connection issue: {e}. Make sure to run 'python populate_database.py' first.")

    yield

    # Shutdown (nothing needed for now)


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app with lifespan
app = FastAPI(title="Gorgonetics Labs", version="1.0.0", lifespan=lifespan)


# Database dependency
def get_database() -> "DuckLakeGeneDatabase":
    """Get database instance for dependency injection."""
    return create_database_instance()


class GeneUpdate(BaseModel):
    """Model for gene update requests."""

    animal_type: str
    gene: str
    effectDominant: str | None = None
    effectRecessive: str | None = None
    appearance: str | None = None
    notes: str | None = None


class PetCreate(BaseModel):
    """Model for creating a new pet."""

    name: str
    gender: str = "Male"
    attributes: dict[str, int] | None = None
    notes: str | None = None


class PetUpdate(BaseModel):
    """Model for updating pet attributes."""

    name: str | None = None
    gender: str | None = None
    breed: str | None = None
    attributes: dict[str, int] | None = None
    notes: str | None = None


# Bulk gene update model
class BulkGeneUpdate(BaseModel):
    """Model for bulk gene update requests."""

    animal_type: str
    chromosome: str
    genes: list[dict[str, str | None]]


# Bulk gene update endpoint
@app.put("/api/genes")
async def update_genes_bulk(
    bulk_update: BulkGeneUpdate, 
    current_admin: User = Depends(require_admin),
    db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> dict[str, str]:
    """Bulk update genes for a chromosome."""
    try:
        updated = 0
        for gene in bulk_update.genes:
            updates = {}
            if gene.get("effectDominant") is not None:
                updates["effectDominant"] = gene["effectDominant"]
            if gene.get("effectRecessive") is not None:
                updates["effectRecessive"] = gene["effectRecessive"]
            if gene.get("appearance") is not None:
                updates["appearance"] = gene["appearance"]
            if gene.get("notes") is not None:
                updates["notes"] = gene["notes"]
            if not updates:
                continue
            gene_name = gene.get("gene")
            if not gene_name:
                continue
            # Filter out None values from updates
            filtered_updates = {k: v for k, v in updates.items() if v is not None}
            if not filtered_updates:
                continue
            success = db.update_gene(animal_type=bulk_update.animal_type, gene=gene_name, updates=filtered_updates)
            if success:
                updated += 1
        return {"status": "success", "message": f"{updated} genes updated"}
    except Exception as e:
        logger.error(f"Error bulk updating genes: {e}")
        raise HTTPException(status_code=500, detail="Failed to update genes") from e


@app.get("/api/gene-effects/{species}")
async def get_gene_effects(species: str, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, Any]:
    """Get all gene effects for visualization component."""
    try:
        # Normalize species name
        species_key = species.lower()
        if species_key == "horse":
            species_key = "horse"
        elif species_key in ["bee", "beewasp", "wasp"]:
            species_key = "beewasp"

        all_effects = {}

        # Get all genes for this species in a single query (much faster than N+1 queries)
        all_genes = db.get_genes_for_animal(species_key)

        for gene_data in all_genes:
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
async def get_pet_genome_for_visualization(
    pet_id: int, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> dict[str, Any]:
    """Get pet genome data formatted for visualization."""
    try:
        pet_data = db.get_pet(pet_id)
        if not pet_data:
            raise HTTPException(status_code=404, detail="Pet not found")

        # Parse the genome JSON - handle both string and dict cases

        # Handle both string (original DB) and dict (DuckLake DB) cases
        if isinstance(pet_data["genome_data"], str):
            genome_json = json.loads(pet_data["genome_data"])
        else:
            genome_json = pet_data["genome_data"]

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
async def get_animal_types(db: "DuckLakeGeneDatabase" = Depends(get_database)) -> list[str]:
    """Get list of available animal types."""
    try:
        return db.get_animal_types()
    except Exception as e:
        logger.error(f"Error getting animal types: {e}")
        raise HTTPException(status_code=500, detail="Failed to get animal types") from e


@app.get("/api/chromosomes/{animal_type}")
async def get_chromosomes(animal_type: str, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> list[str]:
    """Get list of chromosomes for an animal type."""
    try:
        return db.get_chromosomes(animal_type)
    except Exception as e:
        logger.error(f"Error getting chromosomes for {animal_type}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get chromosomes") from e


@app.get("/api/genes/{animal_type}/{chromosome}")
async def get_genes(
    animal_type: str, chromosome: str, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> list[dict[str, str]]:
    """Get all genes for a specific chromosome."""
    try:
        return db.get_genes_by_chromosome(animal_type, chromosome)
    except Exception as e:
        logger.error(f"Error getting genes for {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get genes") from e


@app.get("/api/gene/{animal_type}/{gene}")
async def get_gene(animal_type: str, gene: str, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, Any]:
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
async def update_gene(gene_update: GeneUpdate, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, str]:
    """Update a gene's data."""
    try:
        updates = {}
        if gene_update.effectDominant is not None:
            updates["effectDominant"] = gene_update.effectDominant
        if gene_update.effectRecessive is not None:
            updates["effectRecessive"] = gene_update.effectRecessive
        if gene_update.appearance is not None:
            updates["appearance"] = gene_update.appearance
        if gene_update.notes is not None:
            updates["notes"] = gene_update.notes

        success = db.update_gene(animal_type=gene_update.animal_type, gene=gene_update.gene, updates=updates)

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
    """Get all possible gene effect options."""
    return AttributeConfig.get_effect_options()


@app.get("/api/effect-options/{species}")
async def get_effect_options_for_species(species: str) -> list[str]:
    """Get gene effect options for a specific species."""
    try:
        logger.info(f"Getting effect options for species: '{species}'")

        # Normalize species name to handle database vs config mismatches
        # Database might have "BeeWasp" while config expects "beewasp"
        normalized_species = species.lower()

        # Map common database names to config names
        species_mapping = {"beewasp": "beewasp", "bee": "beewasp", "wasp": "beewasp", "horse": "horse"}

        config_species = species_mapping.get(normalized_species, normalized_species)
        logger.info(f"Mapped '{species}' -> '{config_species}' for AttributeConfig")

        effects = AttributeConfig.get_effect_options_for_species(config_species)
        logger.info(f"Returning {len(effects)} effect options for {config_species}")
        return effects
    except Exception as e:
        logger.error(f"Error getting effect options for species {species}: {e}")
        # Return all options as fallback instead of failing
        logger.info("Falling back to all effect options")
        return AttributeConfig.get_effect_options()


@app.get("/api/attribute-config/{species}")
async def get_attribute_config(species: str) -> dict[str, Any]:
    """Get attribute configuration for a specific species."""
    try:
        return {
            "species": species,
            "attributes": AttributeConfig.get_attribute_display_info(species),
            "all_attribute_names": AttributeConfig.get_all_attribute_names(species),
            "core_attributes": list(AttributeConfig.get_core_attributes().keys()),
            "species_attributes": list(AttributeConfig.get_species_attributes(species).keys()),
        }
    except Exception as e:
        logger.error(f"Error getting attribute config for species {species}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get attribute configuration") from e


@app.get("/api/appearance-config/{species}")
async def get_appearance_config(species: str) -> dict[str, Any]:
    """Get appearance attribute configuration for a specific species."""
    try:
        return {
            "species": species,
            "appearance_attributes": AttributeConfig.get_appearance_display_info(species),
            "appearance_attribute_names": AttributeConfig.get_appearance_attribute_names(species),
        }
    except Exception as e:
        logger.error(f"Error getting appearance config for species {species}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get appearance configuration") from e


@app.get("/api/export/{animal_type}")
async def export_all_chromosomes(
    animal_type: str, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> dict[str, str | list[str]]:
    """Export all chromosomes for an animal type to JSON files."""
    try:
        # Get all chromosomes for this animal type
        chromosomes = db.get_chromosomes(animal_type)
        exported_files = []

        for chromosome in chromosomes:
            genes_data = db.export_genes_to_json(animal_type, chromosome)
            if genes_data:
                filename = f"{animal_type}_{chromosome}.json"
                exported_files.append(filename)

        return {"status": "success", "files": ", ".join(exported_files)}
    except Exception as e:
        logger.error(f"Error exporting chromosomes for {animal_type}: {e}")
        raise HTTPException(status_code=500, detail="Failed to export chromosomes") from e


@app.get("/api/download/{animal_type}/{chromosome}")
async def download_chromosome_file(
    animal_type: str, chromosome: str, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> Response:
    """Download a chromosome JSON file."""
    try:
        data = db.export_genes_to_json(animal_type, chromosome)
        json_data = json.dumps(data, indent=2)
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
    name: str = Form(""),  # Optional override name
    gender: str = Form("Male"),  # Pet's gender
    notes: str | None = Form(None),
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
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

        # Check for empty or invalid content
        if not genome_content.strip():
            raise HTTPException(status_code=400, detail="File cannot be empty")

        # Basic validation for genome file format
        if "[Overview]" not in genome_content and "Genome Type:" not in genome_content:
            raise HTTPException(status_code=400, detail="Invalid genome file format")

        # Parse the genome using our models
        from .models import Genome

        # Create a temporary file to use with our existing parser
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt") as temp_file:
            temp_file.write(genome_content)
            temp_file_path = temp_file.name

        try:
            # Parse the genome
            # Always parse the genome file and store the full gene data for correct counting
            genome = Genome.from_file(temp_file_path)
            genome_json = genome.to_json()

            # Defensive: ensure gene data is present and well-formed
            import json

            try:
                parsed = json.loads(genome_json)
                if "genes" not in parsed or not parsed["genes"]:
                    raise ValueError("No genes found in parsed genome")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to parse genome genes: {e}") from e

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

            attributes_dict = AttributeConfig.get_default_values(genome.genome_type)

            # Create the pet in the database
            pet_id = db.add_pet(
                name=pet_name,
                species=genome.genome_type,
                breeder=genome.breeder,
                genome_data=genome_json,
                content_hash=content_hash,
                user_id=current_user.id,
                gender=gender,
                attributes=attributes_dict,
                notes=notes,
            )

            if pet_id is None:
                return {"status": "error", "message": "Failed to create pet"}
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
async def get_pets(
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> list[dict[str, Any]]:
    """Get all pets for the current user."""
    try:
        pets = db.get_all_pets(user_id=current_user.id)
        # Handle datetime objects if they exist (for compatibility with both database types)
        for pet in pets:
            if pet.get("created_at") and hasattr(pet["created_at"], "isoformat"):
                pet["created_at"] = pet["created_at"].isoformat()
            if pet.get("notes") is None:
                pet["notes"] = ""
        return pets
    except Exception as e:
        logger.error(f"Error getting pets: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pets") from e


@app.get("/api/pets/{pet_id}")
async def get_pet(pet_id: int, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, Any]:
    """Get a specific pet by ID."""
    try:
        pet = db.get_pet(pet_id)
        if pet is None:
            raise HTTPException(status_code=404, detail="Pet not found")

        # Convert datetime objects to strings and handle None values
        if pet.get("created_at") and hasattr(pet["created_at"], "isoformat"):
            pet["created_at"] = pet["created_at"].isoformat()
        if pet.get("updated_at") and hasattr(pet["updated_at"], "isoformat"):
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
async def update_pet(
    pet_id: int, pet_update: PetUpdate, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> dict[str, str]:
    """Update a pet's attributes."""
    try:
        updates = {}
        if pet_update.name is not None:
            updates["name"] = pet_update.name
        if pet_update.gender is not None:
            updates["gender"] = pet_update.gender
        if pet_update.breed is not None:
            updates["breed"] = pet_update.breed
        if pet_update.notes is not None:
            updates["notes"] = pet_update.notes
        if pet_update.attributes is not None:
            # Flatten attributes - they are stored as individual columns in the database
            updates.update(pet_update.attributes)

        success = db.update_pet(pet_id=pet_id, updates=updates)

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
async def delete_pet(pet_id: int, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, str]:
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
async def get_pets_by_species(
    species: str, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> list[dict[str, str | int | float]]:
    """Get all pets of a specific species."""
    try:
        pets = db.get_all_pets(species=species)
        # Convert to the expected return type
        result: list[dict[str, str | int | float]] = []
        for pet in pets:
            pet_dict: dict[str, str | int | float] = {}
            for key, value in pet.items():
                if isinstance(value, str | int | float):
                    pet_dict[key] = value
                elif value is not None:
                    pet_dict[key] = str(value)
            result.append(pet_dict)
        return result
    except Exception as e:
        logger.error(f"Error getting pets for species {species}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get pets") from e


# Authentication endpoints

@app.post("/api/auth/register", response_model=User)
async def register(user_create: UserCreate) -> User:
    """Register a new user."""
    try:
        # Check if username already exists
        existing_user = get_user_by_username(user_create.username)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered"
            )
        
        # Check if email already exists
        db = create_database_instance()
        try:
            existing_email = db.conn.execute(
                "SELECT id FROM users WHERE email = ?", (user_create.email,)
            ).fetchone()
            if existing_email:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered"
                )
        finally:
            db.close()
        
        # Create user with hashed password
        password_hash = get_password_hash(user_create.password)
        user = create_user_in_db(user_create, password_hash)
        
        logger.info(f"New user registered: {user.username}")
        return user
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to register user"
        ) from e


@app.post("/api/auth/login", response_model=Token)
async def login(user_login: UserLogin) -> Token:
    """Authenticate user and return access token."""
    try:
        # Get user from database
        user = get_user_by_username(user_login.username)
        if not user or not verify_password(user_login.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Inactive user"
            )
        
        # Create token pair
        token_data = {
            "sub": user.username,
            "user_id": user.id,
            "role": user.role
        }
        tokens = create_token_pair(token_data)
        
        logger.info(f"User logged in: {user.username}")
        return Token(**tokens)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        ) from e


@app.get("/api/auth/me", response_model=User)
async def get_current_user_info(current_user: User = Depends(get_current_active_user)) -> User:
    """Get current user information."""
    return current_user


@app.post("/api/auth/logout")
async def logout(current_user: User = Depends(get_current_active_user)) -> dict[str, str]:
    """Logout user (client should discard tokens)."""
    logger.info(f"User logged out: {current_user.username}")
    return {"message": "Successfully logged out"}
