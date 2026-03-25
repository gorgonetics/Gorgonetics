"""
Pet and Genetic Data Models for Gorgonetics

This module contains Pydantic models to represent pets, their genomes, and genetic attributes.
Uses the centralized attribute configuration system for dynamic attribute handling.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any

from pydantic import BaseModel, Field

from gorgonetics.attribute_config import AttributeConfig
from gorgonetics.constants import DEMO_USER_ID, Gender
from gorgonetics.genome_parser import generate_block_letters, parse_genome_file_genes, parse_genome_file_header

# Attribute value type with validation
AttributeValue = Annotated[int, Field(ge=0, le=100, description="Attribute value between 0 and 100")]


# Horse breed data with abbreviations
HORSE_BREEDS = {
    "Standardbred": "Sb",
    "Kurbone": "Kb",
    "Ilmarian": "Il",
    "Plateau Pony": "Po",
    "Satincoat": "Sc",
    "Statehelm": "St",
    "Blanketed": "Bl",
    "Leopard": "Le",
    "Paint": "Pt",
    "Calico": "Cl",
}

# Reverse mapping for abbreviation to full name lookup
HORSE_BREED_ABBREVIATIONS = {v: k for k, v in HORSE_BREEDS.items()}


class CoreAttributes(BaseModel):
    """Core attributes shared by all pet species."""

    intelligence: AttributeValue = 50
    toughness: AttributeValue = 50
    friendliness: AttributeValue = 50
    ruggedness: AttributeValue = 50
    enthusiasm: AttributeValue = 50
    virility: AttributeValue = 50


class BeeWaspAttributes(CoreAttributes):
    """Attributes specific to BeeWasp species."""

    ferocity: AttributeValue = 50


class HorseAttributes(CoreAttributes):
    """Attributes specific to Horse species."""

    temperament: AttributeValue = 50


# Union type for all possible attribute classes
PetAttributes = BeeWaspAttributes | HorseAttributes | CoreAttributes


def create_attributes_for_species(species: str, **kwargs: int) -> PetAttributes:
    """Create appropriate attribute class for a given species."""
    species_lower = species.lower()

    if "beewasp" in species_lower or "bee" in species_lower:
        return BeeWaspAttributes(**kwargs)
    elif "horse" in species_lower:
        return HorseAttributes(**kwargs)
    else:
        return CoreAttributes(**kwargs)


class GeneType(StrEnum):
    """Represents the type of gene combination."""

    RECESSIVE = "R"  # Both alleles recessive
    DOMINANT = "D"  # Both alleles dominant
    MIXED = "x"  # One dominant, one recessive
    UNKNOWN = "?"  # Unknown gene type


class Gene(BaseModel):
    """Represents a single gene with its combination type and position."""

    chromosome: str
    block: str
    position: int
    gene_type: GeneType


class Genome(BaseModel):
    """Represents a pet's complete genome."""

    format_version: str
    breeder: str
    name: str
    genome_type: str
    genes: dict[str, list[Gene]] = Field(default_factory=dict)

    @classmethod
    def from_file(cls, file_path: str | Path) -> Genome:
        """Load a genome from a file."""
        # Parse header information using shared utility
        header_info = parse_genome_file_header(file_path)

        # Parse chromosome gene data using shared utility
        chromosome_data = parse_genome_file_genes(file_path)

        # Convert gene data to Gene objects
        genes: dict[str, list[Gene]] = {}
        for chr_num, gene_data in chromosome_data.items():
            chr_num_padded = chr_num.zfill(2)  # Ensure 2-digit format
            chromosome_genes = cls.parse_chromosome_genes(chr_num_padded, gene_data)
            genes[chr_num_padded] = chromosome_genes

        return cls(
            format_version=header_info["format_version"],
            breeder=header_info["breeder"],
            name=header_info["name"],
            genome_type=header_info["genome_type"],
            genes=genes,
        )

    @staticmethod
    def parse_chromosome_genes(chromosome: str, gene_data: str) -> list[Gene]:
        """Parse genes for a single chromosome."""
        genes: list[Gene] = []
        blocks = gene_data.split()

        # Generate block letters using shared utility
        block_letters = generate_block_letters(len(blocks))

        for block_idx, block_data in enumerate(blocks):
            if block_idx >= len(block_letters):
                break

            block_letter = block_letters[block_idx]

            # Each character in the block represents one gene
            for pos_idx, gene_char in enumerate(block_data):
                # Convert character to GeneType
                try:
                    gene_type = GeneType(gene_char)
                    position = pos_idx + 1

                    gene = Gene(chromosome=chromosome, block=block_letter, position=position, gene_type=gene_type)
                    genes.append(gene)
                except ValueError:
                    # Skip invalid gene characters
                    continue

        return genes

    def get_chromosome_genes(self, chromosome: str) -> list[Gene]:
        """Get all genes for a specific chromosome."""
        return self.genes.get(chromosome.zfill(2), [])

    def get_gene(self, gene_id: str) -> Gene | None:
        """Get a specific gene by ID (e.g., '01A1')."""
        if len(gene_id) < 4:
            return None

        chromosome = gene_id[:2]
        block = gene_id[2:-1]
        position = int(gene_id[-1])

        chromosome_genes = self.get_chromosome_genes(chromosome)
        for gene in chromosome_genes:
            if gene.block == block and gene.position == position:
                return gene

        return None

    def get_all_genes(self) -> list[Gene]:
        """Get all genes across all chromosomes."""
        all_genes: list[Gene] = []
        for chromosome_genes in self.genes.values():
            all_genes.extend(chromosome_genes)
        return all_genes

    def to_dict(self) -> dict[str, Any]:
        """Export genome data to dictionary format."""
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Genome:
        """Create a genome from dictionary data."""
        return cls.model_validate(data)

    def to_json(self) -> str:
        """Export genome data to JSON format."""
        return self.model_dump_json(indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> Genome:
        """Create a genome from JSON string."""
        return cls.model_validate_json(json_str)


class Pet(BaseModel):
    """Represents a complete pet with genome, attributes, and metadata."""

    name: str
    user_id: int
    genome: Genome
    gender: Gender = Gender.MALE
    attributes: PetAttributes
    notes: str = ""
    is_public: bool = False

    def __init__(self, **data: Any) -> None:
        """Initialize Pet with species-specific attributes."""
        if "attributes" not in data and "genome" in data:
            # Auto-create species-specific attributes if not provided
            genome_data = data["genome"]
            if isinstance(genome_data, dict):
                species = genome_data.get("genome_type", "")
            else:
                species = getattr(genome_data, "genome_type", "")

            data["attributes"] = create_attributes_for_species(species)
        elif "attributes" in data:
            # Handle conversion from dict or custom attribute classes
            attrs = data["attributes"]
            if isinstance(attrs, dict):
                # Convert dict to appropriate attribute class
                genome_data = data.get("genome")
                if isinstance(genome_data, dict):
                    species = genome_data.get("genome_type", "")
                else:
                    species = getattr(genome_data, "genome_type", "") if genome_data else ""

                data["attributes"] = create_attributes_for_species(species, **attrs)

        super().__init__(**data)

    @classmethod
    def from_genome_file(
        cls,
        name: str,
        genome_file: str | Path,
        gender: Gender = Gender.MALE,
        notes: str = "",
        user_id: int | None = None,
    ) -> Pet:
        """Create a pet from a genome file."""
        genome = Genome.from_file(genome_file)

        # Create species-specific attributes
        defaults = AttributeConfig.get_default_values(genome.genome_type)
        species_attributes = create_attributes_for_species(genome.genome_type, **defaults)

        pet = cls(
            name=name,
            user_id=user_id if user_id is not None else DEMO_USER_ID,
            genome=genome,
            gender=gender,
            attributes=species_attributes,
            notes=notes,
        )

        # Calculate initial attributes based on genome
        pet._calculate_attributes()

        return pet

    def _calculate_attributes(self) -> None:
        """Calculate attribute values based on genetic data."""
        # This is a placeholder implementation
        # In the future, this will use the gene effects database
        # to calculate actual attribute values based on dominant/recessive effects

        # For now, we'll set base values based on species
        defaults = AttributeConfig.get_default_values(self.genome.genome_type)
        self.attributes = create_attributes_for_species(self.genome.genome_type, **defaults)

        # TODO: Implement actual genetic calculation using the gene database
        # This will require:
        # 1. Loading gene effects from the database
        # 2. Determining which effects are active based on dominant/recessive alleles
        # 3. Calculating cumulative effects on each attribute

    def get_gene(self, gene_id: str) -> Gene | None:
        """Get a specific gene by ID."""
        return self.genome.get_gene(gene_id)

    def get_chromosome_genes(self, chromosome: str) -> list[Gene]:
        """Get all genes for a specific chromosome."""
        return self.genome.get_chromosome_genes(chromosome)

    def get_species(self) -> str:
        """Get the pet's species."""
        return self.genome.genome_type

    def get_attribute_value(self, attribute_name: str) -> int:
        """Get the value for a specific attribute."""
        return getattr(self.attributes, attribute_name.lower(), 50)

    def set_attribute_value(self, attribute_name: str, value: int) -> None:
        """Set the value for a specific attribute."""
        attr_key = attribute_name.lower()
        if hasattr(self.attributes, attr_key):
            setattr(self.attributes, attr_key, value)
        else:
            raise ValueError(f"Invalid attribute '{attribute_name}' for species '{self.get_species()}'")

    def get_attribute_display_info(self) -> list[dict[str, Any]]:
        """Get attribute display information for frontend."""
        return AttributeConfig.get_attribute_display_info(self.get_species())

    def has_attribute(self, attribute_name: str) -> bool:
        """Check if this pet has a specific attribute."""
        return AttributeConfig.is_valid_attribute(attribute_name, self.get_species())

    def to_dict(self) -> dict[str, Any]:
        """Export pet data to dictionary format."""
        return self.model_dump()

    def to_json(self) -> str:
        """Export pet data to JSON format."""
        return self.model_dump_json(indent=2)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Pet:
        """Create a pet from dictionary data."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str) -> Pet:
        """Create a pet from JSON string."""
        return cls.model_validate_json(json_str)
