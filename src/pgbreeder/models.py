"""
Pet and Genetic Data Models for PGBreeder

This module contains Pydantic models to represent pets, their genomes, and genetic attributes.
Provides automatic validation, serialization, and API documentation.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .genome_parser import generate_block_letters, parse_genome_file_genes, parse_genome_file_header


class GeneType(str, Enum):
    """Represents the type of gene combination."""

    RECESSIVE = "R"  # Both alleles recessive
    DOMINANT = "D"  # Both alleles dominant
    MIXED = "x"  # One dominant, one recessive
    UNKNOWN = "?"  # Unknown gene type


class Attribute(str, Enum):
    """Pet attributes that can be affected by genes."""

    INTELLIGENCE = "Intelligence"
    TOUGHNESS = "Toughness"
    SPEED = "Speed"
    FRIENDLINESS = "Friendliness"
    RUGGEDNESS = "Ruggedness"
    FEROCITY = "Ferocity"
    ENTHUSIASM = "Enthusiasm"
    VIRILITY = "Virility"


class Gene(BaseModel):
    """Represents a single gene with its combination type and position."""

    chromosome: str
    block: str
    position: int
    gene_type: GeneType


class AttributeValues(BaseModel):
    """Represents the calculated attribute values for a pet."""

    intelligence: float = 0.0
    toughness: float = 0.0
    speed: float = 0.0
    friendliness: float = 0.0
    ruggedness: float = 0.0
    ferocity: float = 0.0
    enthusiasm: float = 0.0
    virility: float = 0.0

    def get_attribute_value(self, attribute: Attribute) -> float:
        """Get the value for a specific attribute."""
        value = getattr(self, attribute.value.lower())
        return float(value)

    def set_attribute_value(self, attribute: Attribute, value: float) -> None:
        """Set the value for a specific attribute."""
        setattr(self, attribute.value.lower(), value)


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
    attributes: AttributeValues = Field(default_factory=AttributeValues)
    screenshot_path: Path | None = None
    notes: str = ""

    @classmethod
    def from_genome_file(
        cls, name: str, genome_file: str | Path, screenshot_path: str | Path | None = None, notes: str = ""
    ) -> Pet:
        """Create a pet from a genome file."""
        genome = Genome.from_file(genome_file)

        screenshot = Path(screenshot_path) if screenshot_path else None

        pet = cls(name=name, genome=genome, screenshot_path=screenshot, notes=notes)

        # Calculate initial attributes based on genome
        pet._calculate_attributes()

        return pet

    def _calculate_attributes(self) -> None:
        """Calculate attribute values based on genetic data."""
        # This is a placeholder implementation
        # In the future, this will use the gene effects database
        # to calculate actual attribute values based on dominant/recessive effects

        # For now, we'll set base values
        self.attributes = AttributeValues(
            intelligence=50.0,
            toughness=50.0,
            speed=50.0,
            friendliness=50.0,
            ruggedness=50.0,
            ferocity=50.0,
            enthusiasm=50.0,
            virility=50.0,
        )

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
