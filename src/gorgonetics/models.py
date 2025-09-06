"""
Pet and Genetic Data Models for Gorgonetics

This module contains Pydantic models to represent pets, their genomes, and genetic attributes.
Uses the centralized attribute configuration system for dynamic attribute handling.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .attribute_config import AttributeConfig
from .genome_parser import generate_block_letters, parse_genome_file_genes, parse_genome_file_header

# Attribute value type with validation
AttributeValue = Annotated[int, Field(ge=0, le=100, description="Attribute value between 0 and 100")]


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


class GeneType(str, Enum):
    """Represents the type of gene combination."""

    RECESSIVE = "R"  # Both alleles recessive
    DOMINANT = "D"  # Both alleles dominant
    MIXED = "x"  # One dominant, one recessive
    UNKNOWN = "?"  # Unknown gene type


class Gender(str, Enum):
    """Represents a pet's gender."""

    MALE = "Male"
    FEMALE = "Female"


class Gene(BaseModel):
    """Represents a single gene with its combination type and position."""

    chromosome: str
    block: str
    position: int
    gene_type: GeneType


class DynamicAttributeValues(BaseModel):
    """Dynamically represents attribute values for any pet species."""

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    species: str = ""
    attribute_values: dict[str, float] = Field(default_factory=dict)

    def __init__(self, species: str = "", **data: Any) -> None:
        """Initialize with species-specific attributes."""
        # Extract attributes from data if provided
        attributes = data.pop("attributes", data.pop("attribute_values", {}))

        # Get default values for this species
        defaults = AttributeConfig.get_default_values(species)

        # Merge provided attributes with defaults
        final_attributes = defaults.copy()
        final_attributes.update(attributes)

        super().__init__(species=species, attribute_values=final_attributes, **data)

    @field_validator("attribute_values")
    @classmethod
    def validate_attributes(cls, v: dict[str, float], info: Any) -> dict[str, float]:
        """Validate that all attributes are valid for the species."""
        if not info.data:
            return v

        species = info.data.get("species", "")
        if not species:
            return v

        errors = AttributeConfig.validate_attribute_dict(v, species)
        if errors:
            raise ValueError(f"Invalid attributes: {errors}")
        return v

    def get_attribute_value(self, attribute_name: str) -> float:
        """Get the value for a specific attribute."""
        attr_key = attribute_name.lower()
        return self.attribute_values.get(attr_key, 0.0)

    def set_attribute_value(self, attribute_name: str, value: float) -> None:
        """Set the value for a specific attribute."""
        attr_key = attribute_name.lower()

        # Validate that this attribute is valid for the species
        if not AttributeConfig.is_valid_attribute(attr_key, self.species):
            raise ValueError(f"Invalid attribute '{attribute_name}' for species '{self.species}'")

        self.attribute_values[attr_key] = float(value)

    def get_all_attributes(self) -> dict[str, float]:
        """Get all attributes as a dictionary."""
        return self.attribute_values.copy()

    def get_attribute_names(self) -> list[str]:
        """Get list of all attribute names for this species."""
        return AttributeConfig.get_all_attribute_names(self.species)

    def has_attribute(self, attribute_name: str) -> bool:
        """Check if this species has a specific attribute."""
        return AttributeConfig.is_valid_attribute(attribute_name, self.species)

    def get_core_attributes(self) -> dict[str, float]:
        """Get only the core attributes."""
        core_names = AttributeConfig.get_core_attribute_names()
        return {name: self.attribute_values.get(name, 0.0) for name in core_names}

    def get_species_specific_attributes(self) -> dict[str, float]:
        """Get only the species-specific attributes."""
        species_names = AttributeConfig.get_species_attribute_names(self.species)
        return {name: self.attribute_values.get(name, 0.0) for name in species_names}

    def __getattr__(self, name: str) -> float:
        """Allow dot notation access to attributes."""
        attr_key = name.lower()
        if attr_key in self.attribute_values:
            return self.attribute_values[attr_key]
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        """Allow dot notation setting of attributes."""
        # Handle special pydantic fields normally
        if name.startswith("_") or name in ["species", "attribute_values"]:
            super().__setattr__(name, value)
            return

        attr_key = name.lower()
        if hasattr(self, "attribute_values") and AttributeConfig.is_valid_attribute(attr_key, self.species):
            self.attribute_values[attr_key] = float(value)
        else:
            super().__setattr__(name, value)


def create_attribute_values_for_species(species: str) -> PetAttributes:
    """Create appropriate attribute values for a given species."""
    return create_attributes_for_species(species)


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
    genome: Genome
    gender: Gender = Gender.MALE
    attributes: PetAttributes
    screenshot_path: Path | None = None
    notes: str = ""

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
            elif isinstance(attrs, DynamicAttributeValues):
                # Convert from legacy attribute classes
                attrs_dict = attrs.get_all_attributes()
                data["attributes"] = create_attributes_for_species(attrs.species, **attrs_dict)

        super().__init__(**data)

    @classmethod
    def from_genome_file(
        cls,
        name: str,
        genome_file: str | Path,
        gender: Gender = Gender.MALE,
        screenshot_path: str | Path | None = None,
        notes: str = "",
    ) -> Pet:
        """Create a pet from a genome file."""
        genome = Genome.from_file(genome_file)

        screenshot = Path(screenshot_path) if screenshot_path else None

        # Create species-specific attributes
        defaults = AttributeConfig.get_default_values(genome.genome_type)
        species_attributes = create_attributes_for_species(genome.genome_type, **defaults)

        pet = cls(
            name=name,
            genome=genome,
            gender=gender,
            attributes=species_attributes,
            screenshot_path=screenshot,
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
