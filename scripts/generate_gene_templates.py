#!/usr/bin/env python3
"""
Gene Template Generator for Project Gorgon Pet Breeding

This script generates JSON template files for each chromosome based on genome data.
It reads a genome file and creates individual JSON files for each chromosome with
placeholder gene information.
"""

import json
import os
import sys
from pathlib import Path

# Add src to path to import shared utilities
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from gorgonetics.genome_parser import count_blocks_in_chromosome, generate_block_letters


def parse_genome_file(file_path: str) -> tuple[str, dict[str, str]]:
    """
    Parse a genome file and extract genome type and chromosome data.
    This function is kept for backward compatibility with existing code.

    Args:
        file_path: Path to the genome file

    Returns:
        Tuple of (genome_type, chromosome_data_dict)
    """
    from gorgonetics.genome_parser import parse_genome_file_genes, parse_genome_file_header

    header_info = parse_genome_file_header(file_path)
    chromosome_data = parse_genome_file_genes(file_path)

    return header_info["genome_type"].lower(), chromosome_data


def generate_chromosome_template(chr_num: str, gene_data: str) -> list[dict[str, str]]:
    """
    Generate a JSON template for a single chromosome.

    Args:
        chr_num: Chromosome number (e.g., "01", "02")
        gene_data: Gene data string

    Returns:
        List of gene dictionaries
    """
    # Split gene data into blocks
    blocks = [block for block in gene_data.split() if block and len(block) >= 2]
    block_letters = generate_block_letters(len(blocks))

    genes: list[dict[str, str]] = []

    for i, block_letter in enumerate(block_letters):
        # Get the actual block data to determine how many genes it has
        block_data = blocks[i] if i < len(blocks) else ""
        num_genes_in_block = len(block_data)

        for gene_pos in range(1, num_genes_in_block + 1):  # Only create genes based on actual data
            gene_id = f"{chr_num}{block_letter}{gene_pos}"
            gene_entry = {
                "gene": gene_id,
                "effectDominant": "None",
                "effectRecessive": "None",
                "appearance": "|String for me to fill in|",
                "notes": "|String for me to fill in|",
            }
            genes.append(gene_entry)

    return genes


def create_template_files(genome_file: str, output_dir: str) -> None:
    """
    Create all chromosome template files for a genome.

    Args:
        genome_file: Path to the genome file
        output_dir: Directory to create template files in
    """
    # Parse the genome file
    genome_type, chromosomes = parse_genome_file(genome_file)

    # Create output directory if it doesn't exist
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    print(f"Generating templates for {genome_type} genome...")
    print(f"Found {len(chromosomes)} chromosomes")

    # Generate template for each chromosome
    for chr_num, gene_data in chromosomes.items():
        # Skip only completely empty chromosomes (no data at all)
        if not gene_data or not gene_data.strip():
            print(f"Skipping chromosome {chr_num} (completely empty)")
            continue

        num_blocks = count_blocks_in_chromosome(gene_data)
        print(f"Chromosome {chr_num}: {num_blocks} blocks")

        # Generate template
        template = generate_chromosome_template(chr_num, gene_data)

        # Write to file
        filename = f"{genome_type}_genes_chr{chr_num}.json"
        file_path = output_path / filename

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(template, f, indent=2, ensure_ascii=False)

        print(f"Created {filename} with {len(template)} genes")

    print(f"\\nAll template files created in: {output_path}")


def main() -> None:
    """Main function to run the generator."""
    # Define animal types with their genome files and output directories
    animal_types = [
        {
            "name": "Bee/Wasp",
            "genome_file": "data/Genes_BabyFaeBee178.txt",
            "output_dir": "assets/beewasp",
        },
        {
            "name": "Horse",
            "genome_file": "data/Genes_Roach.txt",
            "output_dir": "assets/horse",
        },
    ]

    print("🧬 Gorgonetics Gene Template Generator")
    print("=" * 40)

    for animal in animal_types:
        print(f"\n📁 Processing {animal['name']} genome...")

        # Check if genome file exists
        if not os.path.exists(animal["genome_file"]):
            print(f"❌ Error: Genome file '{animal['genome_file']}' not found!")
            print("   Skipping this animal type.")
            continue

        try:
            create_template_files(animal["genome_file"], animal["output_dir"])
            print(f"✅ Successfully generated {animal['name']} templates!")
        except Exception as e:
            print(f"❌ Error generating {animal['name']} templates: {e}")

    print("\n🎉 Gene template generation complete!")


if __name__ == "__main__":
    main()
