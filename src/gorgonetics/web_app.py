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

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

from gorgonetics.attribute_config import AttributeConfig
from gorgonetics.auth import (
    Token,
    User,
    UserCreate,
    UserLogin,
    create_token_pair,
    get_password_hash,
    verify_password,
    verify_token,
)
from gorgonetics.auth.dependencies import (
    create_user_in_db,
    get_current_active_user,
    get_optional_current_user,
    get_user_by_username,
    require_admin,
)
from gorgonetics.constants import DEMO_USER_ID, GENOME_FILE_MARKERS, Gender, UserRole
from gorgonetics.database_config import create_database_instance
from gorgonetics.models import Genome

if TYPE_CHECKING:
    from gorgonetics.ducklake_database import DuckLakeGeneDatabase


def _auto_populate_genes(db: "DuckLakeGeneDatabase") -> None:
    """Load gene data from assets directory into an empty database."""
    import json as _json
    from pathlib import Path

    beewasp_dir = Path("assets/beewasp")
    horse_dir = Path("assets/horse")
    files: list[Path] = []
    if beewasp_dir.exists():
        files.extend(sorted(beewasp_dir.glob("beewasp_genes_chr*.json")))
    if horse_dir.exists():
        files.extend(sorted(horse_dir.glob("horse_genes_chr*.json")))

    if not files:
        logger.warning("GORGONETICS_LOAD_SAMPLE_DATA=true but no asset files found in assets/beewasp or assets/horse")
        return

    total = 0
    for file_path in files:
        animal_type = "beewasp" if "beewasp" in file_path.name else "horse"
        chr_num = file_path.stem.split("_chr")[1]
        with open(file_path, encoding="utf-8") as f:
            genes_data = _json.load(f)
        for gene_data in genes_data:
            record = {
                "effectDominant": gene_data.get("effectDominant") or gene_data.get("effect", "None"),
                "effectRecessive": gene_data.get("effectRecessive", "None"),
                "appearance": gene_data.get("appearance", ""),
                "notes": gene_data.get("notes", ""),
            }
            db._upsert_gene(animal_type, chr_num, gene_data["gene"], record)
            total += 1

    if db.conn is not None:
        db.conn.commit()
    logger.info(f"Auto-populated {total} genes from assets.")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan handler."""
    # Startup
    try:
        db = create_database_instance()
        animal_types = db.get_animal_types()
        if animal_types:
            logger.info(f"Database connected. Found {len(animal_types)} animal types.")
        else:
            load_sample = os.getenv("GORGONETICS_LOAD_SAMPLE_DATA", "false").lower() == "true"
            if load_sample:
                logger.info(
                    "Database is empty and GORGONETICS_LOAD_SAMPLE_DATA=true — loading gene data from assets..."
                )
                _auto_populate_genes(db)
            else:
                logger.warning(
                    "Database is empty. Run 'uv run gorgonetics populate' to load gene data, "
                    "or set GORGONETICS_LOAD_SAMPLE_DATA=true to auto-load on startup."
                )
        db.close()
    except Exception as e:
        logger.warning(f"Database connection issue on startup: {e}")

    yield

    # Shutdown (nothing needed for now)


# Configure logging — JSON format when GORGONETICS_ENV=production for log aggregators
def _configure_logging() -> logging.Logger:
    log_level = os.getenv("GORGONETICS_LOG_LEVEL", "INFO").upper()
    _logger = logging.getLogger("gorgonetics")
    _logger.setLevel(getattr(logging, log_level, logging.INFO))

    if not _logger.handlers:
        handler = logging.StreamHandler()
        if os.getenv("GORGONETICS_ENV") == "production":
            formatter = logging.Formatter(
                '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
                datefmt="%Y-%m-%dT%H:%M:%S",
            )
        else:
            formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
        handler.setFormatter(formatter)
        _logger.addHandler(handler)
        _logger.propagate = False

    return _logger


logger = _configure_logging()

# Rate limiter — disabled automatically when TESTING=1 (set by test fixtures)
limiter = Limiter(key_func=get_remote_address, enabled=not bool(os.getenv("TESTING")))

# Initialize FastAPI app with lifespan
app = FastAPI(title="Gorgonetics Labs", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# CORS — configure allowed origins via GORGONETICS_CORS_ORIGINS env var (comma-separated)
# Defaults to "*" for development. Set explicitly in production.
_cors_origins = [o.strip() for o in os.getenv("GORGONETICS_CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject security headers on every response."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        # Content-Security-Policy — restrictive defaults, allow inline styles for Svelte
        csp = os.getenv(
            "GORGONETICS_CSP",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        )
        response.headers["Content-Security-Policy"] = csp

        # HSTS — only in production (behind TLS termination)
        if os.getenv("GORGONETICS_ENV") == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"

        return response


app.add_middleware(_SecurityHeadersMiddleware)

# Mount static files if directory exists
static_dir = "static"
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


# Database dependency
def get_database() -> "DuckLakeGeneDatabase":
    """Get database instance for dependency injection."""
    return create_database_instance()


def _authorize_pet_mutation(
    pet_id: int, current_user: User, db: "DuckLakeGeneDatabase", action: str = "modified"
) -> dict:
    """Check pet exists, isn't a demo pet, and is owned by the user (or user is admin). Returns pet data."""
    pet_data = db.get_pet(pet_id)
    if not pet_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")
    if pet_data.get("user_id") == DEMO_USER_ID:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Demo pets cannot be {action}")
    if current_user.role != UserRole.ADMIN and pet_data.get("user_id") != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")
    return pet_data


class GeneUpdate(BaseModel):
    """Model for gene update requests."""

    animal_type: str
    gene: str
    effectDominant: str | None = None
    effectRecessive: str | None = None
    appearance: str | None = None
    notes: str | None = None


class PetUpdate(BaseModel):
    """Model for updating pet attributes."""

    name: str | None = None
    gender: Gender | None = None
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
    _current_admin: User = Depends(require_admin),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update genes") from e


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get gene effects"
        ) from e


@app.get("/api/pet-genome/{pet_id}")
async def get_pet_genome_for_visualization(
    pet_id: int, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> dict[str, Any]:
    """Get pet genome data formatted for visualization."""
    try:
        pet_data = db.get_pet(pet_id)
        if not pet_data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")

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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get pet genome") from e


@app.get("/api/animal-types")
async def get_animal_types(db: "DuckLakeGeneDatabase" = Depends(get_database)) -> list[str]:
    """Get list of available animal types."""
    try:
        return db.get_animal_types()
    except Exception as e:
        logger.error(f"Error getting animal types: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get animal types"
        ) from e


@app.get("/api/chromosomes/{animal_type}")
async def get_chromosomes(animal_type: str, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> list[str]:
    """Get list of chromosomes for an animal type."""
    try:
        return db.get_chromosomes(animal_type)
    except Exception as e:
        logger.error(f"Error getting chromosomes for {animal_type}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get chromosomes"
        ) from e


@app.get("/api/genes/{animal_type}/{chromosome}")
async def get_genes(
    animal_type: str, chromosome: str, db: "DuckLakeGeneDatabase" = Depends(get_database)
) -> list[dict[str, str]]:
    """Get all genes for a specific chromosome."""
    try:
        return db.get_genes_by_chromosome(animal_type, chromosome)
    except Exception as e:
        logger.error(f"Error getting genes for {animal_type}/{chromosome}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get genes") from e


@app.get("/api/gene/{animal_type}/{gene}")
async def get_gene(animal_type: str, gene: str, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, Any]:
    """Get a specific gene."""
    try:
        gene_data = db.get_gene(animal_type, gene)
        if gene_data is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gene not found")
        return gene_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting gene {animal_type}/{gene}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get gene") from e


@app.put("/api/gene")
async def update_gene(
    gene_update: GeneUpdate,
    _current_admin: User = Depends(require_admin),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
) -> dict[str, str]:
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update gene")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating gene: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update gene") from e


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get attribute configuration"
        ) from e


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get appearance configuration"
        ) from e


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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to export chromosomes"
        ) from e


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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to download file") from e


# Pet Management Endpoints


@app.post("/api/pets/upload")
async def upload_pet_genome(
    file: UploadFile = File(...),
    name: str = Form(""),  # Optional override name
    gender: str = Form(Gender.MALE),  # Pet's gender
    notes: str | None = Form(None),
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
) -> dict[str, str | int]:
    """Upload a genome file and create a new pet."""
    try:
        # Enforce file size limit (default 5 MB)
        max_bytes = int(os.getenv("GORGONETICS_MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))
        content = await file.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File too large. Maximum size is {max_bytes // (1024 * 1024)} MB.",
            )

        # Compute SHA-256 hash of file content
        content_hash = hashlib.sha256(content).hexdigest()

        # Check if this exact file was already uploaded
        existing_pet = db.find_pet_by_hash(content_hash)
        if existing_pet:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"This file has already been uploaded as '{existing_pet['name']}' on {existing_pet['created_at']}",
            )

        # Decode content as text
        try:
            genome_content = content.decode("utf-8")
        except UnicodeDecodeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File must be a valid text file") from e

        # Check for empty or invalid content
        if not genome_content.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File cannot be empty")

        if not any(marker in genome_content for marker in GENOME_FILE_MARKERS):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid genome file format")

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
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to parse genome genes: {e}"
                ) from e

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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create pet") from e


class PaginatedPetsResponse(BaseModel):
    """Paginated response wrapper for pet lists."""

    items: list[dict[str, Any]]
    total: int
    limit: int | None
    offset: int


@app.get("/api/pets")
async def get_pets(
    current_user: User | None = Depends(get_optional_current_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
    limit: int | None = Query(None, ge=1, le=200, description="Max pets to return (omit for all)"),
    offset: int = Query(0, ge=0, description="Number of pets to skip"),
) -> PaginatedPetsResponse:
    """Get pets for the current user with optional pagination.

    Returns a ``PaginatedPetsResponse`` with ``items``, ``total``, ``limit``,
    and ``offset`` so the frontend can render page controls.  When ``limit``
    is omitted the full list is returned (backwards-compatible).
    """
    try:
        user_id: int | None
        if current_user is None:
            logger.info("Getting demo pets for anonymous user")
            user_id = DEMO_USER_ID
            user_display = "anonymous"
        else:
            logger.info(f"Getting pets for user {current_user.username} (role={current_user.role})")
            user_id = None if current_user.role == UserRole.ADMIN else current_user.id
            user_display = current_user.username

        total = db.count_pets(user_id=user_id)
        pets = db.get_all_pets(user_id=user_id, limit=limit, offset=offset)
        logger.info(f"Returning {len(pets)}/{total} pets for {user_display}")

        # Handle datetime objects if they exist (for compatibility with both database types)
        for pet in pets:
            if pet.get("created_at") and hasattr(pet["created_at"], "isoformat"):
                pet["created_at"] = pet["created_at"].isoformat()
            if pet.get("notes") is None:
                pet["notes"] = ""
            # Mark demo pets as read-only
            if pet.get("user_id") == DEMO_USER_ID:
                pet["is_demo"] = True
                pet["readonly"] = True

        return PaginatedPetsResponse(items=pets, total=total, limit=limit, offset=offset)
    except Exception as e:
        user_display = "anonymous" if current_user is None else current_user.username
        logger.error(f"Error getting pets for user {user_display}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get pets") from e


@app.get("/api/pets/{pet_id}")
async def get_pet(pet_id: int, db: "DuckLakeGeneDatabase" = Depends(get_database)) -> dict[str, Any]:
    """Get a specific pet by ID."""
    try:
        pet = db.get_pet(pet_id)
        if pet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")

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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get pet") from e


@app.put("/api/pets/{pet_id}")
async def update_pet(
    pet_id: int,
    pet_update: PetUpdate,
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
) -> dict[str, str]:
    """Update a pet's attributes."""
    try:
        _authorize_pet_mutation(pet_id, current_user, db, action="modified")

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
            # Convert integer values to strings for database storage
            str_attributes = {k: str(v) for k, v in pet_update.attributes.items()}
            updates.update(str_attributes)

        success = db.update_pet(pet_id=pet_id, updates=updates)

        if success:
            return {"status": "success", "message": "Pet updated successfully"}
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating pet {pet_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update pet") from e


@app.delete("/api/pets/{pet_id}")
async def delete_pet(
    pet_id: int,
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
) -> dict[str, str]:
    """Delete a pet."""
    try:
        _authorize_pet_mutation(pet_id, current_user, db, action="deleted")

        success = db.delete_pet(pet_id)

        if success:
            return {"status": "success", "message": "Pet deleted successfully"}
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pet not found")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting pet {pet_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete pet") from e


@app.get("/api/pets/species/{species}")
async def get_pets_by_species(
    species: str,
    current_user: User = Depends(get_current_active_user),
    db: "DuckLakeGeneDatabase" = Depends(get_database),
) -> list[dict[str, str | int | float]]:
    """Get pets of a specific species. Admins can see all pets, users see only their own."""
    try:
        # Admins can see all pets of a species, regular users only see their own
        user_id = None if current_user.role == UserRole.ADMIN else current_user.id
        pets = db.get_all_pets(species=species, user_id=user_id)
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
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get pets") from e


# Authentication endpoints


@app.post("/api/auth/register", response_model=User)
@limiter.limit("3/minute")
async def register(request: Request, user_create: UserCreate) -> User:  # noqa: ARG001 — request required by slowapi
    """Register a new user."""
    try:
        # Check if username already exists
        existing_user = get_user_by_username(user_create.username)
        if existing_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")

        # Create user with hashed password
        password_hash = get_password_hash(user_create.password)
        user = create_user_in_db(user_create, password_hash)

        logger.info(f"New user registered: {user.username}")
        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to register user") from e


@app.post("/api/auth/login", response_model=Token)
@limiter.limit("5/minute")
async def login(request: Request, user_login: UserLogin) -> Token:  # noqa: ARG001 — request required by slowapi
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user")

        # Create token pair
        token_data = {"sub": user.username, "user_id": user.id, "role": user.role}
        tokens = create_token_pair(token_data)

        logger.info(f"User logged in: {user.username}")
        return Token(**tokens)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Login failed") from e


@app.get("/api/auth/me", response_model=User)
async def get_current_user_info(current_user: User = Depends(get_current_active_user)) -> User:
    """Get current user information."""
    return current_user


@app.post("/api/auth/logout")
async def logout(current_user: User = Depends(get_current_active_user)) -> dict[str, str]:
    """Logout user (client should discard tokens)."""
    logger.info(f"User logged out: {current_user.username}")
    return {"message": "Successfully logged out"}


class TokenRefreshRequest(BaseModel):
    """Model for token refresh requests."""

    refresh_token: str


@app.post("/api/auth/refresh", response_model=Token)
async def refresh_token(token_request: TokenRefreshRequest) -> Token:
    """Exchange a valid refresh token for a new token pair."""
    token_data = verify_token(token_request.refresh_token, "refresh")
    if token_data is None or token_data.username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = get_user_by_username(token_data.username)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    new_tokens = create_token_pair({"sub": user.username, "user_id": user.id, "role": user.role})
    logger.info(f"Token refreshed for user: {user.username}")
    return Token(**new_tokens)


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint for container orchestration."""
    from datetime import datetime

    return {"status": "healthy", "timestamp": datetime.now().isoformat(), "service": "gorgonetics"}


# Catch-all route for SPA frontend
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str) -> FileResponse:
    """Serve the frontend application for all unmatched routes."""
    # Handle requests for static assets (CSS, JS, images, etc.)
    if (
        full_path.startswith("assets/")
        or full_path.startswith("static/")
        or full_path.endswith((".js", ".css", ".png", ".jpg", ".ico", ".svg", ".woff", ".woff2"))
    ):
        # Try different possible locations for the asset
        possible_paths = [
            f"static/svelte/{full_path}",  # Direct path under svelte
            f"static/{full_path}",  # Direct path under static
            f"static/svelte/assets/{full_path.replace('assets/', '')}" if full_path.startswith("assets/") else None,
        ]

        for file_path in possible_paths:
            if file_path and os.path.exists(file_path):
                return FileResponse(file_path)

        # If asset not found, return 404
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    # For all other routes, serve the main index.html (SPA routing)
    index_path = "static/svelte/index.html"
    if os.path.exists(index_path):
        return FileResponse(index_path)

    # Fallback if index.html doesn't exist
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frontend not found")
